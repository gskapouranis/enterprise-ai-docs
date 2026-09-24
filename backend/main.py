import os
import json
import shutil
import io
import zipfile
from typing import List, Optional, Dict
from datetime import datetime, date
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
from pypdf import PdfReader
import chromadb
from chromadb.config import Settings

try:
    from PIL import Image
    import pytesseract
    HAS_OCR = True
except ImportError:
    HAS_OCR = False

from auth import verify_clerk_token

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Αρχικοποίηση Persistent ChromaDB Client
chroma_client = chromadb.PersistentClient(path="./chroma_db")

app = FastAPI(title="Kynva Enterprise AI Engine with ChromaDB RAG")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# FREEMIUM LIMITS CONFIGURATION
MAX_DAILY_AI_CALLS = 10
MAX_STORAGE_BYTES = 20 * 1024 * 1024  # 20 MB

usage_db: Dict[str, Dict] = {}


def check_and_increment_ai_usage(user_id: str):
    today = str(date.today())
    user_usage = usage_db.get(user_id, {"date": today, "count": 0})

    if user_usage["date"] != today:
        user_usage = {"date": today, "count": 0}

    if user_usage["count"] >= MAX_DAILY_AI_CALLS:
        raise HTTPException(
            status_code=429,
            detail=f"Φτάσατε το ημερήσιο όριο των {MAX_DAILY_AI_CALLS} AI ενεργειών (Free Tier)."
        )

    user_usage["count"] += 1
    usage_db[user_id] = user_usage


def calculate_user_storage(user_id: str) -> int:
    base_dir = get_user_base_dir(user_id)
    total_size = 0
    for root, _, files in os.walk(base_dir):
        for f in files:
            full_path = os.path.join(root, f)
            if os.path.exists(full_path):
                total_size += os.path.getsize(full_path)
    return total_size


# --- Pydantic Models ---

class ChatRequest(BaseModel):
    message: str
    thread_id: Optional[str] = "default"
    selected_doc: Optional[str] = "all"

class OrganizeRequest(BaseModel):
    instruction: str


# --- Helpers ---

def get_user_base_dir(user_id: str) -> str:
    path = os.path.join("user_data", user_id)
    os.makedirs(path, exist_ok=True)
    return path


def extract_text_from_file(file_path: str) -> str:
    ext = os.path.splitext(file_path)[1].lower()
    text = ""
    try:
        if ext == ".pdf":
            reader = PdfReader(file_path)
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        elif ext in [".jpg", ".jpeg", ".png", ".bmp"] and HAS_OCR:
            image = Image.open(file_path)
            text = pytesseract.image_to_string(image, lang="ell+eng")
        else:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read(20000)
    except Exception:
        pass
    return text


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 100) -> List[str]:
    """
    Χωρίζει το κείμενο σε νοηματικά chunks για το ChromaDB Vector Store.
    """
    words = text.split()
    chunks = []
    for i in range(0, len(words), chunk_size - overlap):
        chunk = " ".join(words[i:i + chunk_size])
        if chunk.strip():
            chunks.append(chunk)
    return chunks


def index_file_in_chromadb(user_id: str, filename: str, file_path: str):
    """
    Διαβάζει το αρχείο, δημιουργεί chunks και τα αποθηκεύει στο ChromaDB collection του χρήστη.
    """
    text = extract_text_from_file(file_path)
    if not text.strip():
        return

    chunks = chunk_text(text)
    if not chunks:
        return

    # Δημιουργία ή ανάκτηση απομονωμένου Chroma Collection ανά χρήστη
    collection_name = f"user_{user_id.replace('-', '_').replace(':', '_')}"
    collection = chroma_client.get_or_create_collection(name=collection_name)

    documents = []
    metadatas = []
    ids = []

    for idx, chunk in enumerate(chunks):
        chunk_id = f"{filename}_chunk_{idx}"
        documents.append(chunk)
        metadatas.append({"filename": filename, "chunk_index": idx})
        ids.append(chunk_id)

    # Προσθήκη/Ενημέρωση στο ChromaDB
    collection.upsert(
        documents=documents,
        metadatas=metadatas,
        ids=ids
    )


# --- Endpoints ---

@app.get("/")
def read_root():
    return {"message": "Kynva Enterprise AI Engine Active"}


@app.get("/usage")
def get_user_usage(user_id: str = Depends(verify_clerk_token)):
    today = str(date.today())
    user_usage = usage_db.get(user_id, {"date": today, "count": 0})
    ai_count = user_usage["count"] if user_usage["date"] == today else 0
    storage_bytes = calculate_user_storage(user_id)

    return {
        "ai_calls_used": ai_count,
        "ai_calls_limit": MAX_DAILY_AI_CALLS,
        "storage_used_bytes": storage_bytes,
        "storage_limit_bytes": MAX_STORAGE_BYTES
    }


@app.get("/documents")
def list_documents(
    folder: Optional[str] = "",
    user_id: str = Depends(verify_clerk_token)
):
    base_dir = get_user_base_dir(user_id)
    target_dir = os.path.join(base_dir, folder) if folder else base_dir

    if not os.path.exists(target_dir):
        return {"documents": [], "folders": []}

    docs = []
    folders = []

    for item in os.listdir(target_dir):
        item_path = os.path.join(target_dir, item)
        if os.path.isdir(item_path):
            folders.append(item)
        elif os.path.isfile(item_path):
            stat = os.stat(item_path)
            mod_time = datetime.fromtimestamp(stat.st_mtime).isoformat()
            docs.append({
                "filename": item,
                "size_bytes": stat.st_size,
                "modified_at": mod_time,
                "folder": folder or "root"
            })

    return {"documents": docs, "folders": folders}


@app.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    folder: Optional[str] = "",
    user_id: str = Depends(verify_clerk_token)
):
    current_storage = calculate_user_storage(user_id)
    incoming_size = sum([f.size or 0 for f in files])

    if current_storage + incoming_size > MAX_STORAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Υπέρβαση ορίου αποθήκευσης (20MB Max στο Free Tier)."
        )

    base_dir = get_user_base_dir(user_id)
    target_dir = os.path.join(base_dir, folder) if folder else base_dir
    os.makedirs(target_dir, exist_ok=True)

    saved_files = []
    for file in files:
        file_path = os.path.join(target_dir, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        saved_files.append(file.filename)

        # Ευρετηρίαση στο ChromaDB σε πραγματικό χρόνο
        index_file_in_chromadb(user_id, file.filename, file_path)

    return {"message": "Upload & ChromaDB Indexing successful", "files": saved_files}


@app.get("/view-file/{filename}")
def view_file(
    filename: str,
    folder: Optional[str] = "",
    user_id: str = Depends(verify_clerk_token)
):
    base_dir = get_user_base_dir(user_id)
    target_dir = os.path.join(base_dir, folder) if folder else base_dir
    file_path = os.path.join(target_dir, filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Το αρχείο δεν βρέθηκε.")

    ext = os.path.splitext(filename)[1].lower()
    media_type = "application/pdf" if ext == ".pdf" else "text/plain"
    if ext in [".png", ".jpg", ".jpeg"]:
        media_type = f"image/{ext.replace('.', '')}"

    return FileResponse(file_path, media_type=media_type)


@app.get("/download-folder/{folder_name}")
def download_folder_zip(
    folder_name: str,
    user_id: str = Depends(verify_clerk_token)
):
    base_dir = get_user_base_dir(user_id)
    folder_path = os.path.join(base_dir, folder_name)

    if not os.path.exists(folder_path) or not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="Ο φάκελος δεν βρέθηκε.")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for root, _, files in os.walk(folder_path):
            for file in files:
                file_full_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_full_path, folder_path)
                zip_file.write(file_full_path, rel_path)

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={folder_name}.zip"}
    )


# --- AI FILE ORGANIZER ---

@app.post("/organize-files")
def organize_files_agent(
    req: OrganizeRequest,
    user_id: str = Depends(verify_clerk_token)
):
    check_and_increment_ai_usage(user_id)

    base_dir = get_user_base_dir(user_id)
    all_files_info = []

    for root, _, files in os.walk(base_dir):
        for f in files:
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, base_dir)
            stat = os.stat(full_path)
            mod_date = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            ext = os.path.splitext(f)[1].lower()

            content = extract_text_from_file(full_path)

            all_files_info.append({
                "filename": rel_path,
                "extension": ext,
                "size_bytes": stat.st_size,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified_date": mod_date,
                "content_preview": content[:1500]
            })

    if not all_files_info:
        return {"message": "Δεν βρέθηκαν αρχεία για οργάνωση.", "actions_taken": []}

    system_prompt = f"""
Είσαι ένας αυτόνομος AI File Organizer Agent.
Εντολή χρήστη: "{req.instruction}"

Αρχεία:
{json.dumps(all_files_info, ensure_ascii=False, indent=2)}

Επίστρεψε ΑΠΟΚΛΕΙΣΤΙΚΑ ένα JSON array:
[
  {{
    "folder_name": "ΟΝΟΜΑ_ΦΑΚΕΛΟΥ",
    "files_to_move": ["filename1.pdf"]
  }}
]
"""

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        res = model.generate_content(system_prompt)
        text_resp = res.text.strip().replace("```json", "").replace("```", "").strip()
        plan = json.loads(text_resp)

        if not isinstance(plan, list):
            plan = [plan]

        total_moved = 0
        summary_actions = []

        for item in plan:
            folder_name = item.get("folder_name")
            files_to_move = item.get("files_to_move", [])

            if folder_name and files_to_move:
                target_folder_path = os.path.join(base_dir, folder_name)
                os.makedirs(target_folder_path, exist_ok=True)

                moved_in_folder = []
                for file_rel in files_to_move:
                    src = os.path.join(base_dir, file_rel)
                    if os.path.exists(src) and os.path.isfile(src):
                        dst = os.path.join(target_folder_path, os.path.basename(file_rel))
                        shutil.move(src, dst)
                        moved_in_folder.append(os.path.basename(file_rel))
                        total_moved += 1

                if moved_in_folder:
                    summary_actions.append(f"Φάκελος '{folder_name}': {len(moved_in_folder)} αρχεία")

        if total_moved == 0:
            return {"message": "Δεν βρέθηκαν αρχεία που να ταιριάζουν στην εντολή σας.", "actions_taken": []}

        return {
            "message": f"Η οργάνωση ολοκληρώθηκε! Μετακινήθηκαν {total_moved} αρχεία ({', '.join(summary_actions)}).",
            "actions_taken": summary_actions
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Σφάλμα AI Organizer Engine: {str(e)}")


# --- RAG CHAT ENGINE VIA CHROMADB ---

@app.post("/chat")
def chat_with_docs(
    req: ChatRequest,
    user_id: str = Depends(verify_clerk_token)
):
    check_and_increment_ai_usage(user_id)

    collection_name = f"user_{user_id.replace('-', '_').replace(':', '_')}"
    
    # Semantic Vector Search στο ChromaDB
    relevant_chunks = []
    try:
        collection = chroma_client.get_collection(name=collection_name)
        results = collection.query(
            query_texts=[req.message],
            n_results=5
        )
        if results and "documents" in results and results["documents"]:
            relevant_chunks = results["documents"][0]
    except Exception:
        relevant_chunks = []

    context_str = "\n\n".join(relevant_chunks) if relevant_chunks else "Δεν βρέθηκαν σχετικές πληροφορίες στη διανυσματική βάση."

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        prompt = f"""
Είσαι ο AI Assistant του Kynva Enterprise. 
Χρησιμοποίησε τα παρακάτω αποσπάσματα (RAG Context) που ανακτήθηκαν από τα έγγραφα του χρήστη για να απαντήσεις με ακρίβεια:

--- CHROMADB RAG CONTEXT ---
{context_str}

Ερώτηση Χρήστη: {req.message}
"""
        response = model.generate_content(prompt)
        return {
            "thread_id": req.thread_id,
            "answer": response.text,
            "sources": []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Σφάλμα AI Engine: {str(e)}")
    