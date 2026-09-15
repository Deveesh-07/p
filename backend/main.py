from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.database import Base, SessionLocal, engine
from backend.routers import router
from backend.seed import seed_if_empty

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="College Event Registration Management System")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)

Base.metadata.create_all(bind=engine)
with SessionLocal() as db:
    seed_if_empty(db)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    index_file = FRONTEND_DIR / "index.html"
    if not index_file.exists():
        return {"message": "Frontend is missing."}
    return FileResponse(index_file)


@app.get("/{asset_path:path}")
def frontend_asset(asset_path: str):
    if asset_path.startswith("api/") or asset_path == "api":
        raise HTTPException(status_code=404, detail="Not found.")
    file_path = (FRONTEND_DIR / asset_path).resolve()
    if FRONTEND_DIR.resolve() not in file_path.parents:
        raise HTTPException(status_code=404, detail="Not found.")
    if file_path.is_file():
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="Not found.")
