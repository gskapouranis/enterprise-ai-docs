"use client";

import { useState, useEffect } from "react";
import { SignInButton, UserButton, useAuth, useUser } from "@clerk/nextjs";

interface FileItem {
  filename: string;
  size_bytes?: number;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface UsageStats {
  ai_calls_used: number;
  ai_calls_limit: number;
  organize_calls_used: number;
  organize_calls_limit: number;
  file_count: number;
  file_limit: number;
}

export default function Home() {
  const { isSignedIn } = useUser();
  const { getToken } = useAuth();

  const [guestId, setGuestId] = useState<string>("");

  const [documents, setDocuments] = useState<FileItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string>("");
  const [usage, setUsage] = useState<UsageStats>({
    ai_calls_used: 0,
    ai_calls_limit: 20,
    organize_calls_used: 0,
    organize_calls_limit: 5,
    file_count: 0,
    file_limit: 20,
  });

  const [selectedFileForView, setSelectedFileForView] = useState<string | null>(null);
  const [fileBlobUrl, setFileBlobUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      content: "Γεια σας! Είμαι ο Kynva AI Assistant. Μπορώ να αναλύσω τα έγγραφά σας, να απαντήσω σε ερωτήσεις (π.χ. ποια έγγραφα λήγουν) ή να τα οργανώσω σε φακέλους!"
    }
  ]);
  const [inputMsg, setInputMsg] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let gid = localStorage.getItem("kynva_guest_id");
    if (!gid) {
      gid = "guest_" + Math.random().toString(36).substring(2, 9);
      localStorage.setItem("kynva_guest_id", gid);
    }
    setGuestId(gid);
  }, []);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    if (isSignedIn) {
      const token = await getToken();
      if (token) return { "Authorization": `Bearer ${token}` };
    }
    return { "X-Guest-ID": guestId || "guest_demo" };
  };

  const fetchUsage = async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("https://kynva-backend.onrender.com/usage", { headers });
      if (res.ok) {
        const data = await res.json();
        setUsage(prev => ({ ...prev, ...data }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDocuments = async (folder: string = "") => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://kynva-backend.onrender.com/documents?folder=${encodeURIComponent(folder)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const docsList = data.documents || [];
        setDocuments(docsList);
        setFolders(data.folders || []);
        setUsage(prev => ({ ...prev, file_count: docsList.length }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (guestId || isSignedIn) {
      fetchDocuments(currentFolder);
      fetchUsage();
    }
  }, [isSignedIn, guestId, currentFolder]);

  // Actions per file: View, Download, Delete
  const handleOpenDocument = async (filename: string) => {
    if (fileBlobUrl) {
      URL.revokeObjectURL(fileBlobUrl);
      setFileBlobUrl(null);
    }

    setSelectedFileForView(filename);
    setPreviewLoading(true);

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://kynva-backend.onrender.com/view-file/${encodeURIComponent(filename)}`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setFileBlobUrl(url);
      } else {
        alert("Αποτυχία φόρτωσης προεπισκόπησης.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownloadFile = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://kynva-backend.onrender.com/view-file/${encodeURIComponent(filename)}`, { headers });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      alert("Σφάλμα κατά το κατέβασμα.");
    }
  };

  const handleDeleteFile = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Θέλετε να διαγράψετε το αρχείο ${filename};`)) return;

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://kynva-backend.onrender.com/delete-file/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers
      });
      if (res.ok) {
        if (selectedFileForView === filename) handleCloseDocument();
        await fetchDocuments(currentFolder);
        await fetchUsage();
      }
    } catch (err) {
      alert("Σφάλμα κατά τη διαγραφή.");
    }
  };

  const handleCloseDocument = () => {
    setSelectedFileForView(null);
    if (fileBlobUrl) {
      URL.revokeObjectURL(fileBlobUrl);
      setFileBlobUrl(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    if (usage.file_count + selectedFiles.length > usage.file_limit) {
      alert(`⚠️ Φτάσατε το όριο των ${usage.file_limit} δωρεάν αρχείων.`);
      return;
    }

    setUploading(true);
    const formData = new FormData();
    for (let i = 0; i < selectedFiles.length; i++) {
      formData.append("files", selectedFiles[i]);
    }

    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`https://kynva-backend.onrender.com/upload?folder=${encodeURIComponent(currentFolder)}`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (res.ok) {
        await fetchDocuments(currentFolder);
        await fetchUsage();
      } else {
        const errData = await res.json();
        alert(errData.detail || "Σφάλμα κατά το ανέβασμα.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || chatLoading) return;

    if (usage.ai_calls_used >= usage.ai_calls_limit) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `⚠️ Εξαντλήσατε τα ${usage.ai_calls_limit} δωρεάν μηνύματα AI.` }]);
      return;
    }

    const userText = inputMsg;
    setInputMsg("");
    const newHistory: ChatMsg[] = [...chatMessages, { role: "user", content: userText }];
    setChatMessages(newHistory);
    setChatLoading(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch("https://kynva-backend.onrender.com/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ message: userText })
      });

      if (response.ok) {
        const data = await response.json();
        setChatMessages([...newHistory, { role: "assistant", content: data.answer }]);
        await fetchDocuments(currentFolder);
        await fetchUsage();
      } else {
        const errData = await response.json();
        setChatMessages([...newHistory, { role: "assistant", content: `⚠️ ${errData.detail || "Σφάλμα."}` }]);
      }
    } catch (err) {
      setChatMessages([...newHistory, { role: "assistant", content: "Σφάλμα σύνδεσης." }]);
    } finally {
      setChatLoading(false);
    }
  };

  const formatKB = (bytes?: number) => {
    if (!bytes) return "0 KB";
    return (bytes / 1024).toFixed(1) + " KB";
  };

  const isDocx = selectedFileForView?.toLowerCase().endsWith(".docx") || selectedFileForView?.toLowerCase().endsWith(".doc");

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
            <div className="hidden sm:flex items-center gap-3 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
              <span>📄 Αρχεία: <strong className="text-slate-200">{usage.file_count}/{usage.file_limit}</strong></span>
              <span className="text-slate-700">|</span>
              <span>💬 AI: <strong className="text-violet-400">{usage.ai_calls_used}/{usage.ai_calls_limit}</strong></span>
              <span className="text-slate-700">|</span>
              <span>⚡ Ταξινόμηση: <strong className="text-amber-400">{usage.organize_calls_used}/{usage.organize_calls_limit}</strong></span>
            </div>

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
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[11px] font-medium">
            <span>✨ Live Interactive Intelligence Platform</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Αποθήκευση, Διαχείριση & Ανάλυση Εγγράφων
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
            Δοκιμάστε δωρεάν: Ανεβάστε τα αρχεία σας, προβάλετε τα και δώστε εντολές στο AI Assistant.
          </p>
        </section>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
          
          {/* Left Column: Documents Warehouse */}
          <section className="lg:col-span-7 space-y-4">
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold text-slate-300">
                    Τα Αρχεία μου ({usage.file_count}/{usage.file_limit}) {currentFolder ? `/ ${currentFolder}` : ""}
                  </h2>
                  {currentFolder && (
                    <button onClick={() => setCurrentFolder("")} className="text-[11px] text-violet-400 underline">
                      ← Πίσω
                    </button>
                  )}
                </div>

                <label className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium cursor-pointer transition-all shadow-md shadow-violet-600/20">
                  <span>+ Ανέβασμα Αρχείου</span>
                  <input type="file" multiple onChange={handleFileUpload} className="hidden" />
                </label>
              </div>

              {uploading && <p className="text-xs text-violet-400 animate-pulse">Ανέβασμα & Ευρετηρίαση στο AI Vector DB...</p>}

              <div className="space-y-2 max-h-[420px] overflow-y-auto">
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
                  <div className="py-12 text-center space-y-2 border border-dashed border-slate-800 rounded-lg">
                    <p className="text-xs text-slate-400 font-medium">Δεν έχετε ανεβάσει ακόμα κάποιο έγγραφο.</p>
                    <p className="text-[11px] text-slate-500">Ανεβάστε έως 20 δωρεάν αρχεία για άμεση δοκιμή!</p>
                  </div>
                ) : (
                  documents.map((doc, idx) => (
                    <div 
                      key={idx} 
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-violet-500/40 flex items-center justify-between transition-all group"
                    >
                      <div className="flex items-center gap-2.5 truncate max-w-[50%]">
                        <span className="text-base">📄</span>
                        <span className="text-xs text-slate-200 truncate">{doc.filename}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 font-mono hidden sm:inline mr-2">{formatKB(doc.size_bytes)}</span>
                        
                        <button
                          onClick={() => handleOpenDocument(doc.filename)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-violet-600 text-slate-200 hover:text-white text-[11px] font-medium transition-all"
                          title="Προβολή"
                        >
                          👁️ Προβολή
                        </button>

                        <button
                          onClick={(e) => handleDownloadFile(doc.filename, e)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition-all"
                          title="Κατέβασμα"
                        >
                          📥
                        </button>

                        <button
                          onClick={(e) => handleDeleteFile(doc.filename, e)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-red-600 text-slate-200 hover:text-white text-[11px] font-medium transition-all"
                          title="Διαγραφή"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Right Column: Unified AI Assistant & Organizer */}
          <section className="lg:col-span-5 flex flex-col h-[500px] rounded-xl bg-slate-900/40 border border-slate-800 overflow-hidden">
            <div className="p-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-2">
                💬 Kynva Unified AI Agent
              </span>
              <span className="text-[10px] text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                {usage.ai_calls_limit - usage.ai_calls_used} υπολειπόμενα μηνύματα
              </span>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 text-xs">
              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[85%] p-3 rounded-xl ${msg.role === "user" ? "bg-violet-600 text-white" : "bg-slate-950 border border-slate-800 text-slate-200 whitespace-pre-wrap"}`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && <p className="text-[11px] text-violet-400 animate-pulse">Ο Kynva Agent επεξεργάζεται την εντολή σας...</p>}
            </div>

            <form onSubmit={handleSendChat} className="p-2.5 border-t border-slate-800 bg-slate-950 flex gap-2">
              <input
                type="text"
                value={inputMsg}
                onChange={(e) => setInputMsg(e.target.value)}
                placeholder="Ρωτήστε ή δώστε εντολή (π.χ. 'Ποια έγγραφα λήγουν;' ή 'Βάλε τα μενού στον φάκελο Μενού')..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={chatLoading || usage.ai_calls_used >= usage.ai_calls_limit}
                className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-500 transition-all disabled:opacity-50"
              >
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

            <div className="flex-1 w-full bg-slate-950 flex flex-col items-center justify-center p-4">
              {previewLoading ? (
                <div className="text-xs text-violet-400 animate-pulse">Φόρτωση εγγράφου...</div>
              ) : fileBlobUrl ? (
                isDocx ? (
                  <iframe
                    src={`https://docs.google.com/gview?url=${encodeURIComponent(fileBlobUrl)}&embedded=true`}
                    className="w-full h-full border-none rounded-lg"
                    title="Docx Viewer"
                  />
                ) : (
                  <iframe
                    src={fileBlobUrl}
                    className="w-full h-full border-none rounded-lg"
                    title="Document Preview"
                  />
                )
              ) : (
                <div className="text-xs text-slate-500">Δεν υπάρχει διαθέσιμη προεπισκόπηση.</div>
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
