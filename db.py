import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DB_URL = os.environ.get("DB_URL") or f"sqlite:///{os.environ.get('MOOD_DB_PATH','mood_events.db')}"
# Use nullpool to avoid keeping too many connections in serverless, but default is fine for dev
engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()
