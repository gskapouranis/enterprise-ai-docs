"use client";

import { useState, useEffect } from "react";
import { SignInButton, UserButton, useAuth, useUser } from "@clerk/nextjs";

interface FileItem {
  filename: string;
  category?: string;
  size_bytes?: number;
  modified_at?: string;
  summary?: string;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface UsageStats {
  ai_calls_used: number;
  ai_calls_limit: number;
  storage_used_bytes: number;
  storage_limit_bytes: number;
}

export default function Home() {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();

  // State Management
  const [documents, setDocuments] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>("");
  const [usage, setUsage] = useState<UsageStats | null>(null);

  // Document Preview Drawer State
  const [selectedFileForView, setSelectedFileForView] = useState<string | null>(null);
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: "Γεια σας! Καλώς ήρθατε στο Kynva. Ανεβάστε ένα έγγραφο ή κάντε μια ερώτηση για να ξεκινήσουμε."
    }
  ]);
  const [inputMsg, setInputMsg] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // AI File Agent
  const [agentInstruction, setAgentInstruction] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);

  // Fetch Usage
  const fetchUsage = async () => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("https://kynva-backend.onrender.com/usage", {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch Documents
  const fetchDocuments = async (folder: string = "") => {
    if (!isSignedIn) return;
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`https://kynva-backend.onrender.com/documents?folder=${encodeURIComponent(folder)}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
        setFolders(data.folders || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (isSignedIn) {
      fetchDocuments(currentFolder);
      fetchUsage();
    }
  }, [isSignedIn, currentFolder]);

  // Open Document Preview
  const handleOpenDocument = async (filename: string) => {
    if (!isSignedIn) {
      alert("Παρακαλώ συνδεθείτε πρώτα για να δείτε τα έγγραφά σας.");
      return;
    }
    setSelectedFileForView(filename);
    setPreviewLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`https://kynva-backend.onrender.com/view-file/${encodeURIComponent(filename)}?folder=${encodeURIComponent(currentFolder)}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setFileBlobUrl(url);
      } else {
        alert("Αποτυχία φόρτωσης εγγράφου.");
      }
    } catch (err) {
      console.error("Error fetching file:", err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCloseDocument = () => {
    setSelectedFileForView(null);
    if (fileBlobUrl) {
      URL.revokeObjectURL(fileBlobUrl);
      setFileBlobUrl(null);
    }
  };

  // File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    if (!isSignedIn) {
      alert("Παρακαλώ συνδεθείτε (Sign In) για να ανεβάσετε αρχεία στο λογαριασμό σας.");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append("files", selectedFiles[i]);
    }
    try {
      const token = await getToken();
      const res = await fetch(`https://kynva-backend.onrender.com/upload?folder=${encodeURIComponent(currentFolder)}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        alert(errData.detail || "Σφάλμα κατά το ανέβασμα.");
      } else {
        await fetchDocuments(currentFolder);
        await fetchUsage();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  // AI Organizer
  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentInstruction.trim() || agentLoading) return;

    if (!isSignedIn) {
      alert("Παρακαλώ συνδεθείτε για να χρησιμοποιήσετε τον AI Organizer.");
      return;
    }

    setAgentLoading(true);
    setAgentStatus("Επεξεργασία...");

    try {
      const token = await getToken();
      const res = await fetch("https://kynva-backend.onrender.com/organize-files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ instruction: agentInstruction })
      });

      if (!res.ok) {
        const errData = await res.json();
        setAgentStatus(`⚠️ ${errData.detail || "Σφάλμα"}`);
      } else {
        const data = await res.json();
        setAgentStatus(data.message);
        setAgentInstruction("");
        await fetchDocuments(currentFolder);
        await fetchUsage();
      }
    } catch (err) {
      setAgentStatus("Σφάλμα κατά την οργάνωση.");
    } finally {
      setAgentLoading(false);
    }
  };

  // Send Chat
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || chatLoading) return;

    if (!isSignedIn) {
      alert("Παρακαλώ κάντε Σύνδεση (Sign In) για να συνομιλήσετε με τα έγγραφά σας.");
      return;
    }

    const userText = inputMsg;
    setInputMsg("");
    const newHistory: ChatMsg[] = [...chatMessages, { role: "user", content: userText }];
    setChatMessages(newHistory);
    setChatLoading(true);

    try {
      const token = await getToken();
      const response = await fetch("https://kynva-backend.onrender.com/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          message: userText,
          selected_doc: "all"
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        setChatMessages([...newHistory, { role: "assistant", content: `⚠️ ${errData.detail || "Σφάλμα"}` }]);
      } else {
        const data = await response.json();
        setChatMessages([...newHistory, { role: "assistant", content: data.answer }]);
        await fetchUsage();
      }
    } catch (err) {
      setChatMessages([...newHistory, { role: "assistant", content: "Σφάλμα σύνδεσης με τον διακομιστή." }]);
    } finally {
      chatLoading && setChatLoading(false);
    }
  };

  const formatKB = (bytes?: number) => {
    if (!bytes) return "0 KB";
    return (bytes / 1024).toFixed(1) + " KB";
  };

  const formatMB = (bytes?: number) => {
    if (!bytes) return "0 MB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col font-sans selection:bg-violet-500/30 overflow-x-hidden">
      
      {/* Header */}
      <header className="w-full border-b border-slate-800/60 bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentFolder("")}>
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center font-bold text-white text-base shadow-lg shadow-violet-600/30">
              K
            </div>
            <span className="font-bold text-lg text-white tracking-wide">Kynva</span>
          </div>

          <div className="flex items-center gap-4">
            {isSignedIn && usage && (
              <div className="hidden sm:flex items-center gap-3 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                <span>⚡ AI: <strong className="text-violet-400">{usage.ai_calls_used}/{usage.ai_calls_limit}</strong></span>
                <span className="text-slate-700">|</span>
                <span>💾 Space: <strong className="text-slate-200">{formatMB(usage.storage_used_bytes)}/20MB</strong></span>
              </div>
            )}

            {!isSignedIn ? (
              <SignInButton mode="modal">
                <button className="px-4 py-2 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-all shadow-md shadow-violet-600/20">
                  Σύνδεση / Εγγραφή
                </button>
              </SignInButton>
            ) : (
              <UserButton />
            )}
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl mx-auto px-6 pt-8 pb-16 z-10 w-full space-y-8">
        
        {/* Title */}
        <section className="text-left space-y-2 max-w-2xl">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Αποθήκευση, Διαχείριση & Ανάλυση Εγγράφων
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Οργανώστε τα αρχεία σας με απλές εντολές και αναλύστε τα έγγραφά σας σε δευτερόλεπτα.
          </p>
        </section>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          
          {/* Left Column: AI Organizer & Documents */}
          <section className="lg:col-span-7 space-y-6">
            
            {/* AI Command Console */}
            <form onSubmit={handleRunAgent} className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
              <label className="block text-xs font-semibold text-slate-300">
                ⚡ Kynva AI Organizer Console
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={agentInstruction}
                  onChange={(e) => setAgentInstruction(e.target.value)}
                  placeholder="π.χ. 'Βάλε τα τιμολόγια στον φάκελο Οικονομικά'..."
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
                />
                <button
                  type="submit"
                  disabled={agentLoading}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-all disabled:opacity-50"
                >
                  {agentLoading ? "..." : "Εκτέλεση"}
                </button>
              </div>
              {agentStatus && <p className="text-[11px] text-violet-300">{agentStatus}</p>}
            </form>

            {/* Document Warehouse */}
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold text-slate-300">
                    Τα Αρχεία μου {currentFolder ? `/ ${currentFolder}` : ""}
                  </h2>
                  {currentFolder && (
                    <button onClick={() => setCurrentFolder("")} className="text-[11px] text-violet-400 underline">
                      ← Πίσω
                    </button>
                  )}
                </div>

                <label className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer transition-all">
                  <span>+ Ανέβασμα Αρχείου</span>
                  <input type="file" multiple onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {uploading && <p className="text-xs text-violet-400">Ανέβασμα αρχείων στο Cloud...</p>}

              <div className="space-y-2 max-h-[350px] overflow-y-auto">
                {folders.map((f, i) => (
                  <div 
                    key={i} 
                    onClick={() => setCurrentFolder(f)}
                    className="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-violet-500/30 cursor-pointer flex items-center justify-between transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base">📁</span>
                      <span className="text-xs font-medium text-slate-200">{f}</span>
                    </div>
                  </div>
                ))}

                {documents.length === 0 && folders.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">Δεν υπάρχουν αρχεία. Συνδεθείτε και ανεβάστε το πρώτο σας έγγραφο!</p>
                ) : (
                  documents.map((doc, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => handleOpenDocument(doc.filename)}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-violet-500/40 cursor-pointer flex items-center justify-between transition-all group"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="text-base">📄</span>
                        <span className="text-xs text-slate-200 truncate group-hover:text-violet-300">{doc.filename}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-500 font-mono">{formatKB(doc.size_bytes)}</span>
                        <span className="text-[10px] text-violet-400 underline">Προβολή 👁️</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </section>

          {/* Right Column: AI Chat Panel */}
          <section className="lg:col-span-5 flex flex-col h-[520px] rounded-xl bg-slate-900/40 border border-slate-800 overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                💬 Kynva AI Assistant
              </span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-xl ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-slate-950 border border-slate-800 text-slate-200"}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && <p className="text-[11px] text-violet-400">Ο βοηθός διαβάζει τα έγγραφά σας...</p>}
            </div>

            <form onSubmit={handleSendChat} className="p-2.5 border-t border-slate-800 bg-slate-950 flex gap-2">
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Κάντε μια ερώτηση για τα έγγραφά σας..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              />
              <button type="submit" disabled={chatLoading} className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500 transition-all">
                Αποστολή
              </button>
            </form>
          </section>

        </div>

      </main>

      {/* DOCUMENT PREVIEW DRAWER */}
      {selectedFileForView && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-sm">
          <div className="w-full lg:w-2/3 h-full bg-[#090d16] border-l border-slate-800 flex flex-col shadow-2xl">
            
            <div className="p-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📄</span>
                <span className="text-sm font-bold text-white truncate max-w-md">{selectedFileForView}</span>
              </div>
              <button
                onClick={handleCloseDocument}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-medium transition-all"
              >
                ✕ Κλείσιμο
              </button>
            </div>

            <div className="flex-1 w-full bg-slate-950 flex items-center justify-center">
              {previewLoading ? (
                <div className="text-xs text-violet-400 animate-pulse">Φόρτωση εγγράφου από τον server...</div>
              ) : fileBlobUrl ? (
                <iframe
                  src={fileBlobUrl}
                  className="w-full h-full border-none"
                  title="Document Preview"
                />
              ) : (
                <div className="text-xs text-red-400">Αποτυχία προβολής εγγράφου.</div>
              )}
            </div>

          </div>
        </div>
      )}

      <footer className="border-t border-slate-800/60 bg-[#090d16] py-4 text-center text-slate-500 text-[11px]">
        Kynva Document Intelligence Engine
      </footer>

    </div>
  );
}
