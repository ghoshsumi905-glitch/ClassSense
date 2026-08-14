from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from db import Base
import json

# Use JSON text for sqlite, JSONB for Postgres-compatible deployments
class EmotionEvent(Base):
    __tablename__ = 'emotion_events'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=True)
    recognized_name = Column(String, nullable=True)
    session_id = Column(String, nullable=True)
    ts = Column(DateTime(timezone=True), server_default=func.now())
    # Store as text JSON to remain compatible with sqlite; if Postgres used, you may alter to JSONB
    emotion_probs = Column(Text, nullable=False)
    source = Column(String, nullable=True)
    meta = Column(Text, nullable=True)

class Flag(Base):
    __tablename__ = 'flags'
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, nullable=True)
    recognized_name = Column(String, nullable=True)
    ts = Column(DateTime(timezone=True), server_default=func.now())
    reason = Column(Text, nullable=True)
    metrics = Column(Text, nullable=True)
    severity = Column(String, nullable=True)
    status = Column(String, default='open')
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    meta = Column(Text, nullable=True)
