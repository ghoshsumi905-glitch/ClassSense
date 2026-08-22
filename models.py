from db import SQLALCHEMY_AVAILABLE

if SQLALCHEMY_AVAILABLE:
    from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
    from sqlalchemy.sql import func
    from db import Base

    class SchoolClass(Base):
        """A class/session created at login: professor + year + period.
        Face registrations and rosters are scoped to this id so the same
        student name in '1st Year' and '3rd Year' never collide."""
        __tablename__ = 'school_classes'
        id = Column(Integer, primary_key=True, index=True)
        professor_name = Column(String, nullable=False)
        class_year = Column(String, nullable=False)
        period_id = Column(String, nullable=True)
        period_label = Column(String, nullable=True)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class Student(Base):
        """Roster entry for a class. face_registered flips to True once
        register_face_images() has stored at least one encoding for them
        under this class_id."""
        __tablename__ = 'students'
        id = Column(Integer, primary_key=True, index=True)
        class_id = Column(Integer, ForeignKey('school_classes.id'), nullable=False, index=True)
        name = Column(String, nullable=False)
        # 'pending' | 'biometric' | 'non_biometric'
        consent_status = Column(String, default='pending')
        face_registered = Column(Boolean, default=False)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    class LessonSegment(Base):
        """A marked stretch of a live session: 'lecture', 'group_work',
        'quiz', 'discussion'. end_ts is null while the segment is active."""
        __tablename__ = 'lesson_segments'
        id = Column(Integer, primary_key=True, index=True)
        session_id = Column(String, nullable=False, index=True)
        class_id = Column(Integer, ForeignKey('school_classes.id'), nullable=True, index=True)
        segment_type = Column(String, nullable=False)
        start_ts = Column(DateTime(timezone=True), server_default=func.now())
        end_ts = Column(DateTime(timezone=True), nullable=True)

    class Intervention(Base):
        """A teacher's note that they tried something in response to a
        segment's engagement dip. Compared against the next session's
        average for that segment type as a simple before/after signal --
        not a learned model, just an honest average-delta comparison."""
        __tablename__ = 'interventions'
        id = Column(Integer, primary_key=True, index=True)
        class_id = Column(Integer, ForeignKey('school_classes.id'), nullable=False, index=True)
        session_id = Column(String, nullable=True)
        segment_type = Column(String, nullable=True)
        note = Column(Text, nullable=False)
        created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Use JSON text for sqlite, JSONB for Postgres-compatible deployments
    class EmotionEvent(Base):
        __tablename__ = 'emotion_events'
        id = Column(Integer, primary_key=True, index=True)
        user_id = Column(String, nullable=True)
        recognized_name = Column(String, nullable=True)
        session_id = Column(String, nullable=True)
        # Scoping added for per-class / per-segment aggregation. Nullable so
        # historical rows written before this column existed still read fine.
        class_id = Column(Integer, nullable=True, index=True)
        segment_type = Column(String, nullable=True)
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
else:
    # SQLAlchemy not available; models are not defined. main.py will use sqlite3 fallback instead.
    pass