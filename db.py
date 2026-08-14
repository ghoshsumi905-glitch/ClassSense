import os

# Try to import SQLAlchemy; if it's not installed in the environment we fall back
# to a lightweight sqlite3-backed helper in main.py so the app can still run.
try:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker, declarative_base
    SQLALCHEMY_AVAILABLE = True
except Exception:
    SQLALCHEMY_AVAILABLE = False

DB_URL = os.environ.get("DB_URL") or f"sqlite:///{os.environ.get('MOOD_DB_PATH','mood_events.db')}"

if SQLALCHEMY_AVAILABLE:
    # Use nullpool to avoid keeping too many connections in serverless, but default is fine for dev
    engine = create_engine(DB_URL, connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {})
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base = declarative_base()
else:
    engine = None
    SessionLocal = None
    Base = None
