"""
Z-Cockpit backend entry point.
Serves the React frontend from /backend/static and the API on /api/.
"""
import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from backend.routers.openocd import router as openocd_router, ws_router as openocd_ws
from backend.routers.serial_port import router as serial_router, ws_router as serial_ws
from backend.routers.settings import router as settings_router
from backend.routers.projects import router as projects_router, ws_router as projects_ws
from backend.routers.tools import router as tools_router, ws_router as tools_ws

app = FastAPI(title="Z-Cockpit", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VERSION_FILE = Path(__file__).parent.parent / "version.json"

@app.get("/api/version")
async def get_version():
    try:
        data = json.loads(VERSION_FILE.read_text())
        return {"version": data.get("version", "0.000")}
    except Exception:
        return {"version": "0.000"}

# API routers
app.include_router(openocd_router)
app.include_router(openocd_ws)
app.include_router(serial_router)
app.include_router(serial_ws)
app.include_router(settings_router)
app.include_router(projects_router)
app.include_router(projects_ws)
app.include_router(tools_router)
app.include_router(tools_ws)

# Serve built React frontend (production mode)
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/")
    async def serve_spa():
        return FileResponse(str(STATIC_DIR / "index.html"))

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # API and WS routes are handled above; everything else is the SPA
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Frontend not built yet. Run: cd frontend && npm run build")
else:
    @app.get("/")
    async def dev_info():
        return {
            "message": "Z-Cockpit API running",
            "frontend": "Run 'cd frontend && npm run dev' for the frontend (dev mode)",
            "docs": "/docs",
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
