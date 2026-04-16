from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.db import async_engine, init_db
from app.routers import auth, calls, chats, hooks, presence, users, webhooks, ws_events

logger = logging.getLogger("chatapi")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Chat API...")
    await init_db()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    logger.info("Database initialized, upload dir ready.")
    yield
    logger.info("Shutting down Chat API.")


app = FastAPI(title="Chat API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        "%s %s -> %s (%.1fms)",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chats.router)
app.include_router(calls.router)
app.include_router(presence.router)
app.include_router(webhooks.router)
app.include_router(hooks.router)
app.include_router(ws_events.router)

app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")


@app.get("/")
async def root() -> dict:
    return {"status": "ok"}


@app.get("/health")
async def health_check() -> dict:
    status = {"status": "ok", "database": "ok", "storage": "ok"}
    try:
        async with async_engine.connect() as conn:
            await conn.exec_driver_sql("SELECT 1")
    except Exception:
        status["database"] = "error"
        status["status"] = "degraded"

    if not Path(settings.upload_dir).is_dir():
        status["storage"] = "error"
        status["status"] = "degraded"

    return status
