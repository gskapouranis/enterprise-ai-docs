import os
import io
import zipfile
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Query, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from google import genai

app = FastAPI(title="Kynva AI Backend")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gemini Client Setup
gemini_api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None

# In-Memory Store for Demo/Guest Usage
guest_usage_db = {}
# Structure: { guest_id: {"files": [], "chat_count": 0, "organize_count": 0, "folders": {}} }

FREE_FILE_LIMIT = 20
FREE_CHAT_LIMIT = 20
FREE_ORGANIZE_LIMIT = 5

def get_session_id(authorization: Optional[str] = Header(None), x_guest_id: Optional[str] = Header(None)) -> str:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        if token and token != "null" and token != "undefined":
            return f"user_{token[:15]}"
    if x_guest_id:
        return x_guest_id
    return "guest_default"

def init_session(session_id: str):
    if session_id not in guest_usage_db:
        guest_usage_db[session_id] = {
            "files": {},  # {filename: {"content": bytes, "folder": "", "size": int}}
            "chat_count": 0,
            "organize_count": 0,
            "folders": []
        }

class ChatRequest(BaseModel):
    message: str
    selected_doc: Optional[str] = "all"

class OrganizeRequest(BaseModel):
    instruction: str

@app.get("/")
def root():
    return {"status": "ok", "service": "Kynva Engine Live"}

@app.get("/usage")
def get_usage(session_id: str = Depends(get_session_id)):
    init_session(session_id)
    session = guest_usage_db[session_id]
    total_bytes = sum(f["size"] for f in session["files"].values())
    
    return {
        "ai_calls_used": session["chat_count"],
        "ai_calls_limit": FREE_CHAT_LIMIT,
        "organize_calls_used": session["organize_count"],
        "organize_calls_limit": FREE_ORGANIZE_LIMIT,
        "storage_used_bytes": total_bytes,
        "file_count": len(session["files"]),
        "file_limit": FREE_FILE_LIMIT
    }

@app.get("/documents")
def list_documents(folder: Optional[str] = "", session_id: str = Depends(get_session_id)):
    init_session(session_id)
    session = guest_usage_db[session_id]
    
    docs = []
    for fname, fmeta in session["files"].items():
        if fmeta["folder"] == folder:
            docs.append({
                "filename": fname,
                "size_bytes": fmeta["size"]
            })
            
    return {
        "documents": docs,
        "folders": session["folders"]
    }

@app.post("/upload")
async def upload_files(
    folder: Optional[str] = "",
    files: List[UploadFile] = File(...),
    session_id: str = Depends(get_session_id)
):
    init_session(session_id)
    session = guest_usage_db[session_id]
    
    if len(session["files"]) + len(files) > FREE_FILE_LIMIT:
        raise HTTPException(
            status_code=400, 
            detail=f"Φτάσατε το όριο των {FREE_FILE_LIMIT} δωρεάν αρχείων. Διαγράψτε αρχεία ή αναβαθμίστε."
        )

    for file in files:
        content = await file.read()
        session["files"][file.filename] = {
            "content": content,
            "folder": folder,
            "size": len(content)
        }

    return {"message": f"Ανέβηκαν επιτυχώς {len(files)} αρχεία."}

@app.get("/view-file/{filename}")
def view_file(filename: str, folder: Optional[str] = "", session_id: str = Depends(get_session_id)):
    init_session(session_id)
    session = guest_usage_db[session_id]
    
    if filename not in session["files"]:
        raise HTTPException(status_code=404, detail="Το αρχείο δεν βρέθηκε.")
    
    fdata = session["files"][filename]
    return StreamingResponse(io.BytesIO(fdata["content"]), media_type="application/pdf")

@app.post("/chat")
def chat_with_docs(req: ChatRequest, session_id: str = Depends(get_session_id)):
    init_session(session_id)
    session = guest_usage_db[session_id]
    
    if session["chat_count"] >= FREE_CHAT_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Συμπληρώσατε το όριο των {FREE_CHAT_LIMIT} δωρεάν AI μηνυμάτων."
        )

    session["chat_count"] += 1
    
    # Extract text from user files
    context_text = ""
    for fname, fmeta in session["files"].items():
        try:
            text_snippet = fmeta["content"].decode("utf-8", errors="ignore")[:2000]
            context_text += f"\n--- Αρχείο: {fname} ---\n{text_snippet}\n"
        except Exception:
            pass

    if not client:
        return {"answer": f"Έλαβα την ερώτησή σας: '{req.message}'. (Gemini API Key δεν έχει ρυθμιστεί στο Render)."}

    prompt = f"""Είσαι ο Kynva AI Assistant. Απάντησε στην ερώτηση του χρήστη με βάση τα παρακάτω έγγραφα.
    
    Εγγραφα Χρήστη:
    {context_text if context_text else 'Δεν έχουν αναγνωσθεί κείμενα από αρχεία.'}
    
    Ερώτηση Χρήστη: {req.message}
    """

    try:
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
        )
        return {"answer": response.text}
    except Exception as e:
        return {"answer": f"Σφάλμα AI: {str(e)}"}

@app.post("/organize-files")
def organize_files(req: OrganizeRequest, session_id: str = Depends(get_session_id)):
    init_session(session_id)
    session = guest_usage_db[session_id]
    
    if session["organize_count"] >= FREE_ORGANIZE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"Συμπληρώσατε το όριο των {FREE_ORGANIZE_LIMIT} δωρεάν ταξινομήσεων."
        )

    session["organize_count"] += 1
    
    # Example logic: Create folder based on instruction
    target_folder = "Οργανωμένα_Αρχεία"
    if "τιμολογ" in req.instruction.lower() or "οικονομικ" in req.instruction.lower():
        target_folder = "Οικονομικά"
    elif "συμβαλ" in req.instruction.lower() or "συμβασ" in req.instruction.lower():
        target_folder = "Συμβάσεις"

    if target_folder not in session["folders"]:
        session["folders"].append(target_folder)

    for fname in list(session["files"].keys()):
        session["files"][fname]["folder"] = target_folder

    return {"message": f"Τα αρχεία μεταφέρθηκαν επιτυχώς στον φάκελο '{target_folder}'!"}
