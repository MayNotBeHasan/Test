from fastapi import FastAPI, HTTPException, Depends, status, Query, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, Column, String, Boolean, DateTime, Text, Integer, Enum as SAEnum, or_
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from jose import JWTError, jwt
from passlib.context import CryptContext
import uuid
import enum
import json
import io
import fitz
import pytesseract
from PIL import Image
import os
import re
import zipfile
import xml.etree.ElementTree as ET

pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)
print("LOADED DBR_Admin_Backend.py")

AI_COMPLIANCE_MODEL = "qwen3-coder:480b-cloud"
AI_COMPLIANCE_MODE = os.getenv("AI_COMPLIANCE_MODE", "ollama")
AI_RULE_CHAR_LIMIT = int(os.getenv("AI_RULE_CHAR_LIMIT", "50000"))
AI_PDF_CHAR_LIMIT = int(os.getenv("AI_PDF_CHAR_LIMIT", "30000"))
AI_MAX_ISSUES = int(os.getenv("AI_MAX_ISSUES", "12"))
DEBUG_PROMPT_PATH = os.getenv("DEBUG_PROMPT_PATH", "debug_prompt.txt")
DEBUG_RESPONSE_PATH = os.getenv("DEBUG_RESPONSE_PATH", "debug_model_response.json")
 
# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(title="DBR Admin API", version="1.0.0")
 
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
 
# ── Database ───────────────────────────────────────────────────────────────
DATABASE_URL = "sqlite:///./dbr_admin.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
 
# ── Auth ───────────────────────────────────────────────────────────────────
SECRET_KEY = "dbr-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 8
 
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")
 
# ── DB Models ──────────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    admin = "admin"
    officer = "officer"
    metro_authority = "metro_authority"
 
class DocumentStatus(str, enum.Enum):
    uploaded = "uploaded"
    processing = "processing"
    under_scrutiny = "under_scrutiny"
    needs_correction = "needs_correction"
    approved = "approved"
    flagged = "flagged"
 
class RuleCategory(str, enum.Enum):
    safety = "safety"
    calculation = "calculation"
    completeness = "completeness"
    design = "design"
 
class RuleStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    rejected = "rejected"
 
class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(SAEnum(UserRole), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
 
class Rule(Base):
    __tablename__ = "rules"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    clause_ref = Column(String, nullable=False)
    clause_number = Column(String, nullable=True)
    title = Column(String, nullable=True)
    category = Column(SAEnum(RuleCategory), nullable=False)
    rule_type = Column(String, nullable=True)
    rule_text = Column(Text, nullable=False)
    mandatory = Column(Boolean, default=True)
    source_document = Column(String, nullable=True)
    version = Column(String, nullable=True)
    status = Column(String, default=RuleStatus.approved.value)
    metadata_json = Column(Text, nullable=True)
    section_ids_json = Column(Text, default="[]")
    pdf_path = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
 
class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    metro_authority_id = Column(String, nullable=False)
    metro_authority_name = Column(String, nullable=False)
    status = Column(SAEnum(DocumentStatus), default=DocumentStatus.uploaded)
    page_count = Column(Integer, nullable=True)
    version = Column(Integer, default=1)
    s3_key = Column(String, nullable=True)
    section_id = Column(String, nullable=True, index=True)
    ai_result_json = Column(Text, nullable=True)
    review_comment = Column(Text, nullable=True)
    reviewed_by = Column(String, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    parent_document_id = Column(String, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
 
class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id = Column(String, nullable=False)
    actor_name = Column(String, nullable=False)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=False)
    entity_id = Column(String, nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
 
class SectionRule(Base):
    """One rule paragraph per DBR section tree node."""
    __tablename__ = "section_rules"
    id         = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id = Column(String, nullable=False, unique=True, index=True)
    rule_text  = Column(Text, nullable=True)
    created_by = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
 
class SectionPdf(Base):
    """Reference PDFs attached to a SectionRule (supports multiple per section)."""
    __tablename__ = "section_pdfs"
    id          = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    section_id  = Column(String, nullable=False, index=True)
    name        = Column(String, nullable=False)
    path        = Column(String, nullable=False)
    size_bytes  = Column(Integer, nullable=True)
    uploaded_by = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
 
Base.metadata.create_all(bind=engine)
 
# ── Pydantic Schemas ───────────────────────────────────────────────────────
class Token(BaseModel):
    access_token: str
    token_type: str
    user: dict
 
class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: UserRole
 
class UserOut(BaseModel):
    id: str
    name: str
    email: str
    role: UserRole
    is_active: bool
    created_at: datetime
    class Config:
        from_attributes = True
 
class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
 
class RuleCreate(BaseModel):
    clause_ref: str
    category: RuleCategory
    rule_text: str
    clause_number: Optional[str] = None
    title: Optional[str] = None
    rule_type: Optional[str] = None
    mandatory: bool = True
    source_document: Optional[str] = None
    version: Optional[str] = None
    status: RuleStatus = RuleStatus.approved
    keywords: List[str] = []
    parameters: List[Dict[str, Any]] = []
    section_ids: List[str] = []
 
class RuleOut(BaseModel):
    id: str
    clause_ref: str
    clause_number: Optional[str] = None
    title: Optional[str] = None
    category: RuleCategory
    rule_type: Optional[str] = None
    rule_text: str
    mandatory: bool
    keywords: List[str] = []
    parameters: List[Dict[str, Any]] = []
    source_document: Optional[str] = None
    version: Optional[str] = None
    status: RuleStatus
    is_active: bool
    created_by: str
    created_at: datetime
    updated_at: datetime
    section_ids: List[str] = []
    has_pdf: bool = False
 
class RuleUpdate(BaseModel):
    clause_ref: Optional[str] = None
    clause_number: Optional[str] = None
    title: Optional[str] = None
    category: Optional[RuleCategory] = None
    rule_type: Optional[str] = None
    rule_text: Optional[str] = None
    mandatory: Optional[bool] = None
    keywords: Optional[List[str]] = None
    parameters: Optional[List[Dict[str, Any]]] = None
    source_document: Optional[str] = None
    version: Optional[str] = None
    status: Optional[RuleStatus] = None
    is_active: Optional[bool] = None
    section_ids: Optional[List[str]] = None
 
class BulkPasteIngest(BaseModel):
    text: str
    source_document: Optional[str] = "Bulk paste"
    version: Optional[str] = None
 
class BulkApprovalRequest(BaseModel):
    rule_ids: List[str]
 
class DocumentOut(BaseModel):
    id: str
    filename: str
    metro_authority_name: str
    status: DocumentStatus
    page_count: Optional[int]
    version: int
    section_id: Optional[str] = None
    section_label: Optional[str] = None
    ai_result: Optional[Dict[str, Any]] = None
    review_comment: Optional[str] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    parent_document_id: Optional[str] = None
    uploaded_at: datetime
    updated_at: datetime
    class Config:
        from_attributes = True

class ReviewDecision(BaseModel):
    decision: str
    comment: Optional[str] = None
 
class AuditLogOut(BaseModel):
    id: str
    actor_name: str
    action: str
    entity_type: str
    entity_id: str
    detail: Optional[str]
    created_at: datetime
    class Config:
        from_attributes = True
 
class SectionPdfOut(BaseModel):
    id: str
    section_id: str
    name: str
    size_bytes: Optional[int]
    uploaded_at: datetime
    class Config:
        from_attributes = True
 
class SectionRuleOut(BaseModel):
    section_id: str
    rule_text: Optional[str]
    pdfs: List[SectionPdfOut] = []
    updated_at: Optional[datetime]
 
class SectionRuleUpsert(BaseModel):
    rule_text: Optional[str] = None
 
# ── Helpers ────────────────────────────────────────────────────────────────
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
 
def hash_password(password: str) -> str:
    return pwd_context.hash(password)
 
def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
 
def create_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode["exp"] = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
 
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
 
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

def require_officer_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in [UserRole.admin, UserRole.officer]:
        raise HTTPException(status_code=403, detail="Officer access required")
    return current_user
 
def log_action(db, actor: User, action: str, entity_type: str, entity_id: str, detail: str = None):
    entry = AuditLog(
        actor_id=actor.id,
        actor_name=actor.name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail,
    )
    db.add(entry)
    db.commit()
 
def migrate_rule_schema():
    additions = {
        "clause_number": "VARCHAR",
        "title": "VARCHAR",
        "rule_type": "VARCHAR",
        "mandatory": "BOOLEAN DEFAULT 1",
        "source_document": "VARCHAR",
        "version": "VARCHAR",
        "status": "VARCHAR DEFAULT 'approved'",
        "metadata_json": "TEXT",
        "section_ids_json": "TEXT DEFAULT '[]'",
        "pdf_path": "VARCHAR",
    }
    with engine.begin() as conn:
        existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(rules)").fetchall()}
        for column, ddl in additions.items():
            if column not in existing:
                conn.exec_driver_sql(f"ALTER TABLE rules ADD COLUMN {column} {ddl}")
        conn.exec_driver_sql("UPDATE rules SET status = 'approved' WHERE status IS NULL")
        conn.exec_driver_sql("UPDATE rules SET mandatory = 1 WHERE mandatory IS NULL")

def migrate_document_schema():
    additions = {
        "section_id": "VARCHAR",
        "ai_result_json": "TEXT",
        "review_comment": "TEXT",
        "reviewed_by": "VARCHAR",
        "reviewed_at": "DATETIME",
        "parent_document_id": "VARCHAR",
    }
    with engine.begin() as conn:
        existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(documents)").fetchall()}
        for column, ddl in additions.items():
            if column not in existing:
                conn.exec_driver_sql(f"ALTER TABLE documents ADD COLUMN {column} {ddl}")
 
def get_rule_metadata(rule: Rule) -> Dict[str, Any]:
    if not rule.metadata_json:
        return {"keywords": [], "parameters": []}
    try:
        data = json.loads(rule.metadata_json)
        return {
            "keywords": data.get("keywords", []),
            "parameters": data.get("parameters", []),
        }
    except json.JSONDecodeError:
        return {"keywords": [], "parameters": []}

def get_rule_section_ids(rule: Rule) -> List[str]:
    if not rule.section_ids_json:
        return []
    try:
        data = json.loads(rule.section_ids_json)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []
 
def rule_to_out(rule: Rule) -> Dict[str, Any]:
    metadata = get_rule_metadata(rule)
    return {
        "id": rule.id,
        "clause_ref": rule.clause_ref,
        "clause_number": rule.clause_number or rule.clause_ref,
        "title": rule.title,
        "category": rule.category,
        "rule_type": rule.rule_type,
        "rule_text": rule.rule_text,
        "mandatory": bool(rule.mandatory),
        "keywords": metadata["keywords"],
        "parameters": metadata["parameters"],
        "source_document": rule.source_document,
        "version": rule.version,
        "status": rule.status or RuleStatus.approved.value,
        "is_active": bool(rule.is_active),
        "created_by": rule.created_by,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
        "section_ids": get_rule_section_ids(rule),
        "has_pdf": bool(rule.pdf_path and os.path.exists(rule.pdf_path)),
    }
 
def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
 
CLAUSE_RE = re.compile(
    r"^\s*((?:Clause|Cl\.?|Section|Sec\.?)\s*\d+(?:\.\d+)*|(?:\d+(?:\.\d+)+))\s*[:.)-]?\s*(.*)$",
    re.IGNORECASE,
)
NUMBERED_RE = re.compile(r"^\s*(?:\(?[a-zA-Z]\)|\(?\d+\)|\d+[.)])\s+(.+)$")
 
def split_rule_text(text: str) -> List[Dict[str, str]]:
    normalized = normalize_text(text)
    if not normalized:
        return []
 
    rules = []
    current = None
    for raw_line in normalized.split("\n"):
        line = raw_line.strip()
        if not line:
            if current and current["rule_text"]:
                current["rule_text"] += "\n"
            continue
 
        clause_match = CLAUSE_RE.match(line)
        numbered_match = NUMBERED_RE.match(line)
        starts_rule = clause_match or (numbered_match and len(line) > 20)
 
        if starts_rule:
            if current and current["rule_text"].strip():
                rules.append(current)
            if clause_match:
                clause_ref = clause_match.group(1).strip()
                body = clause_match.group(2).strip()
            else:
                clause_ref = ""
                body = numbered_match.group(1).strip()
            current = {"clause_number": clause_ref, "rule_text": body}
        elif current:
            spacer = " " if not current["rule_text"].endswith("\n") else ""
            current["rule_text"] = f"{current['rule_text']}{spacer}{line}".strip()
        else:
            current = {"clause_number": "", "rule_text": line}
 
    if current and current["rule_text"].strip():
        rules.append(current)
 
    if len(rules) <= 1:
        rules = [
            {"clause_number": "", "rule_text": part.strip()}
            for part in re.split(r"\n\s*\n", normalized)
            if len(part.strip()) > 10
        ]
 
    return [r for r in rules if len(r["rule_text"].strip()) > 10]
 
KEYWORD_RULES = {
    "safety": ["fire", "seismic", "emergency", "evacuation", "resistance", "hazard"],
    "calculation": ["load", "calculation", "method", "deformation", "factor", "rate"],
    "completeness": ["submit", "include", "drawing", "report", "certificate", "document"],
    "design": ["design", "width", "depth", "structure", "platform", "station", "tunnel"],
}
UNIT_RE = r"m|mm|cm|km|hours?|hrs?|years?|days?|litres?|liters?|sqm|m2|m\^2|kN|MPa|percent|%"
THRESHOLD_RE = re.compile(
    rf"(?P<phrase>at least|not less than|minimum|min\.?|not exceed|shall not exceed|maximum|max\.?|more than|less than|equal to|=|>=|<=|>|<)\s*(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>{UNIT_RE})?",
    re.IGNORECASE,
)
INDIRECT_THRESHOLD_RE = re.compile(
    rf"(?P<phrase>minimum|min\.?|maximum|max\.?)\s+(?P<parameter>[A-Za-z ]{{3,80}}?)\s+(?:of|as)\s+(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>{UNIT_RE})?",
    re.IGNORECASE,
)
 
def infer_category(text: str) -> RuleCategory:
    lowered = text.lower()
    if any(word in lowered for word in ["fire", "seismic", "emergency", "evacuation", "hazard"]):
        return RuleCategory.safety
    scores = {
        category: sum(1 for word in words if word in lowered)
        for category, words in KEYWORD_RULES.items()
    }
    best = max(scores, key=scores.get)
    return RuleCategory(best) if scores[best] > 0 else RuleCategory.design
 
def infer_rule_type(text: str) -> str:
    lowered = text.lower()
    if THRESHOLD_RE.search(text) or INDIRECT_THRESHOLD_RE.search(text):
        return "threshold"
    if any(word in lowered for word in ["shall", "must", "mandatory", "required"]):
        return "mandatory_requirement"
    if any(word in lowered for word in ["submit", "include", "provide"]):
        return "submission_requirement"
    return "guideline"
 
def infer_mandatory(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in ["shall", "must", "mandatory", "required"])
 
def slug_parameter(text: str) -> str:
    words = re.findall(r"[A-Za-z]+", text.lower())
    stop = {"shall", "be", "at", "least", "not", "less", "than", "minimum", "maximum", "exceed", "the", "a", "an", "of", "to"}
    useful = [w for w in words if w not in stop]
    return "_".join(useful[-3:]) if useful else "threshold"
 
def extract_metadata(rule_text: str, clause_number: str = "") -> Dict[str, Any]:
    lowered = rule_text.lower()
    keywords = sorted({
        word
        for words in KEYWORD_RULES.values()
        for word in words
        if word in lowered
    })
    parameters = []
    for match in THRESHOLD_RE.finditer(rule_text):
        phrase = match.group("phrase").lower()
        operator = ">="
        if phrase in ["not exceed", "shall not exceed", "maximum", "max."]:
            operator = "<="
        elif phrase in ["less than", "<"]:
            operator = "<"
        elif phrase in ["more than", ">"]:
            operator = ">"
        elif phrase in ["equal to", "="]:
            operator = "="
        context = rule_text[max(0, match.start() - 60):match.start()]
        parameters.append({
            "parameter": slug_parameter(context),
            "operator": operator,
            "value": float(match.group("value")),
            "unit": match.group("unit") or "",
        })
    direct_spans = [match.span() for match in THRESHOLD_RE.finditer(rule_text)]
    for match in INDIRECT_THRESHOLD_RE.finditer(rule_text):
        if any(start <= match.start() <= end for start, end in direct_spans):
            continue
        phrase = match.group("phrase").lower()
        operator = "<=" if phrase in ["maximum", "max."] else ">="
        parameters.append({
            "parameter": slug_parameter(match.group("parameter")),
            "operator": operator,
            "value": float(match.group("value")),
            "unit": match.group("unit") or "",
        })
    return {
        "clause_number": clause_number,
        "keywords": keywords,
        "parameters": parameters,
    }
 
def build_draft_rule(piece: Dict[str, str], admin: User, source_document: str, version: Optional[str]) -> Rule:
    rule_text = piece["rule_text"].strip()
    clause_number = piece.get("clause_number") or ""
    metadata = extract_metadata(rule_text, clause_number)
    category = infer_category(rule_text)
    rule_type = infer_rule_type(rule_text)
    return Rule(
        clause_ref=clause_number or "Unreferenced",
        clause_number=clause_number,
        title=rule_text[:80],
        category=category,
        rule_type=rule_type,
        rule_text=rule_text,
        mandatory=infer_mandatory(rule_text),
        source_document=source_document,
        version=version,
        status=RuleStatus.draft.value,
        is_active=False,
        metadata_json=json.dumps({
            "keywords": metadata["keywords"],
            "parameters": metadata["parameters"],
        }),
        created_by=admin.id,
    )
 
migrate_rule_schema()
migrate_document_schema()
 
def seed_data(db: Session):
    if db.query(User).count() > 0:
        return
    admin = User(
        name="System Admin",
        email="admin@uths.gov.in",
        hashed_password=hash_password("admin123"),
        role=UserRole.admin,
    )
    db.add(admin)
    db.flush()
 
    users = [
        User(name="Priya Sharma", email="priya@uths.gov.in", hashed_password=hash_password("pass123"), role=UserRole.officer),
        User(name="Rahul Verma", email="rahul@metrobuild.in", hashed_password=hash_password("pass123"), role=UserRole.metro_authority),
        User(name="Anita Nair", email="anita@uths.gov.in", hashed_password=hash_password("pass123"), role=UserRole.officer),
        User(name="Singh Metro Authorities", email="singh@infra.in", hashed_password=hash_password("pass123"), role=UserRole.metro_authority),
    ]
    for u in users:
        db.add(u)
    db.flush()
 
  
 
    metro_authority_id = users[1].id
    docs = [
        Document(filename="DBR_MetroLine7_Section4.pdf", metro_authority_id=metro_authority_id, metro_authority_name="Rahul Verma", status=DocumentStatus.under_scrutiny, page_count=312, version=1),
        Document(filename="DBR_UndergroundStation_Phase2.pdf", metro_authority_id=metro_authority_id, metro_authority_name="Rahul Verma", status=DocumentStatus.needs_correction, page_count=487, version=2),
        Document(filename="DBR_CutAndCover_North.pdf", metro_authority_id=users[3].id, metro_authority_name="Singh Metro Authorities", status=DocumentStatus.approved, page_count=198, version=1),
        Document(filename="DBR_FoundationDesign_East.pdf", metro_authority_id=users[3].id, metro_authority_name="Singh Metro Authorities", status=DocumentStatus.processing, page_count=None, version=1),
    ]
    for d in docs:
        db.add(d)
 
    logs = [
        AuditLog(actor_id=admin.id, actor_name="System Admin", action="created", entity_type="rule", entity_id="R001", detail="Added seismic design rule for underground structures"),
        AuditLog(actor_id=users[0].id, actor_name="Priya Sharma", action="approved", entity_type="scrutiny_point", entity_id="SP042", detail="Confirmed fire resistance compliance on page 34"),
        AuditLog(actor_id=users[0].id, actor_name="Priya Sharma", action="dismissed", entity_type="scrutiny_point", entity_id="SP043", detail="False positive — clause cited correctly"),
        AuditLog(actor_id=admin.id, actor_name="System Admin", action="deactivated", entity_type="rule", entity_id="R006", detail="IS:875 Pt.2 rule superseded by updated version"),
        AuditLog(actor_id=users[2].id, actor_name="Anita Nair", action="modified", entity_type="scrutiny_point", entity_id="SP089", detail="Updated severity from minor to critical"),
    ]
    for l in logs:
        db.add(l)
 
    db.commit()
 
with SessionLocal() as db:
    seed_data(db)
 
# ── Auth Routes ────────────────────────────────────────────────────────────
@app.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token({"sub": user.id, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "role": user.role, "email": user.email}}
 
@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
 
# ── Rules Routes ───────────────────────────────────────────────────────────
@app.get("/rules", response_model=List[RuleOut])
def list_rules(
    q: Optional[str] = Query(None),
    clause_number: Optional[str] = Query(None),
    category: Optional[RuleCategory] = Query(None),
    status: Optional[RuleStatus] = Query(None),
    rule_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(Rule)
    if q:
        needle = f"%{q.lower()}%"
        query = query.filter(or_(
            Rule.rule_text.ilike(needle),
            Rule.clause_ref.ilike(needle),
            Rule.clause_number.ilike(needle),
            Rule.title.ilike(needle),
            Rule.metadata_json.ilike(needle),
        ))
    if clause_number:
        query = query.filter(or_(
            Rule.clause_ref.ilike(f"%{clause_number}%"),
            Rule.clause_number.ilike(f"%{clause_number}%"),
        ))
    if category:
        query = query.filter(Rule.category == category)
    if status:
        query = query.filter(Rule.status == status.value)
    if rule_type:
        query = query.filter(Rule.rule_type == rule_type)
    return [rule_to_out(rule) for rule in query.order_by(Rule.created_at.desc()).all()]
 
@app.post("/rules", response_model=RuleOut, status_code=201)
def create_rule(rule: RuleCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    data = rule.model_dump()
    keywords = data.pop("keywords", [])
    parameters = data.pop("parameters", [])
    section_ids = data.pop("section_ids", [])
    if not data.get("clause_number"):
        data["clause_number"] = data["clause_ref"]
    data["status"] = data["status"].value if isinstance(data["status"], RuleStatus) else data["status"]
    data["is_active"] = data["status"] == RuleStatus.approved.value
    new_rule = Rule(
        **data,
        metadata_json=json.dumps({"keywords": keywords, "parameters": parameters}),
        section_ids_json=json.dumps(section_ids),
        created_by=admin.id,
    )
    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)
    log_action(db, admin, "created", "rule", new_rule.id, f"Rule: {rule.clause_ref}")
    return rule_to_out(new_rule)
 
@app.patch("/rules/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: str, update: RuleUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    data = update.model_dump(exclude_none=True)
    keywords = data.pop("keywords", None)
    parameters = data.pop("parameters", None)
    section_ids = data.pop("section_ids", None)
    if keywords is not None or parameters is not None:
        metadata = get_rule_metadata(rule)
        if keywords is not None:
            metadata["keywords"] = keywords
        if parameters is not None:
            metadata["parameters"] = parameters
        rule.metadata_json = json.dumps(metadata)
    if section_ids is not None:
        rule.section_ids_json = json.dumps(section_ids)
    if "status" in data and isinstance(data["status"], RuleStatus):
        data["status"] = data["status"].value
    for field, value in data.items():
        setattr(rule, field, value)
    if rule.status == RuleStatus.draft.value:
        rule.is_active = False
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    log_action(db, admin, "updated", "rule", rule_id, f"Updated rule {rule.clause_ref}")
    return rule_to_out(rule)
 
@app.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if rule.pdf_path and os.path.exists(rule.pdf_path):
        os.remove(rule.pdf_path)
    log_action(db, admin, "deleted", "rule", rule_id, f"Deleted rule {rule.clause_ref}")
    db.delete(rule)
    db.commit()

@app.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    if doc.s3_key and os.path.exists(doc.s3_key):
        os.remove(doc.s3_key)

    db.delete(doc)
    db.commit()

    return {"message": "Document deleted"}

@app.post("/rules/{rule_id}/pdf", response_model=RuleOut)
async def upload_rule_pdf(
    rule_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    contents = await file.read()
    if len(contents) > 100 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 100 MB limit")
    if rule.pdf_path and os.path.exists(rule.pdf_path):
        os.remove(rule.pdf_path)
    safe = file.filename.replace(" ", "_")
    path = os.path.join(RULE_PDF_DIR, f"{rule_id}_{safe}")
    with open(path, "wb") as f:
        f.write(contents)
    rule.pdf_path = path
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    log_action(db, admin, "uploaded", "rule_pdf", rule_id, f"Attached PDF {file.filename}")
    return rule_to_out(rule)

@app.get("/rules/{rule_id}/pdf")
def get_rule_pdf(
    rule_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule or not rule.pdf_path:
        raise HTTPException(status_code=404, detail="PDF not found")
    if not os.path.exists(rule.pdf_path):
        raise HTTPException(status_code=404, detail="PDF file missing from disk")
    filename = os.path.basename(rule.pdf_path)
    return FileResponse(
        path=rule.pdf_path,
        media_type="application/pdf",
        filename=filename,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )

@app.delete("/rules/{rule_id}/pdf", status_code=204)
def delete_rule_pdf(
    rule_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    if rule.pdf_path and os.path.exists(rule.pdf_path):
        os.remove(rule.pdf_path)
    rule.pdf_path = None
    rule.updated_at = datetime.utcnow()
    db.commit()
    log_action(db, admin, "deleted", "rule_pdf", rule_id, f"Removed PDF for rule {rule.clause_ref}")
 
def extract_docx_text(contents: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(contents)) as docx:
        xml = docx.read("word/document.xml")
    root = ET.fromstring(xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs = []
    for paragraph in root.findall(".//w:p", namespace):
        text = "".join(node.text or "" for node in paragraph.findall(".//w:t", namespace))
        if text.strip():
            paragraphs.append(text.strip())
    return "\n".join(paragraphs)
 
def extract_pdf_text(contents: bytes, filename: str = "uploaded.pdf") -> str:

    try:

        doc = fitz.open(stream=contents, filetype="pdf")

        pages = []

        total_pages = len(doc)

        print(f"[PDF EXTRACTION] Filename: {filename}")
        print(f"[PDF EXTRACTION] Total Pages: {total_pages}")

        for page_num in range(total_pages):

            page = doc[page_num]

            text = page.get_text().strip()

            if len(text) < 50:

                print(f"[OCR] Page {page_num + 1}/{total_pages}")

                pix = page.get_pixmap(
                    matrix=fitz.Matrix(3, 3)
                )

                img = Image.open(
                    io.BytesIO(
                        pix.tobytes("png")
                    )
                )

                text = pytesseract.image_to_string(
                    img,
                    lang="eng"
                )

            else:

                print(f"[TEXT] Page {page_num + 1}/{total_pages}")

            pages.append(
                f"\n\n=== PAGE {page_num + 1} ===\n{text}"
            )

        doc.close()

        return "\n".join(pages)

    except Exception as e:

        print(f"[PDF EXTRACTION ERROR] {e}")

        return ""

SECTION_LABELS = {
    "s1_1": "1.1 Criteria for Oscillation Trials",
    "s1_2": "1.2 Procedure of Safety Certification",
    "s1_3": "1.3 MoM of Review of Criteria",
    "s2_1_1": "2.1.1 Guidelines for Framing SOD",
    "s2_1_2_1": "2.1.2.1 Model DBR - Viaducts",
    "s2_1_2_2": "2.1.2.2 Model DBR - Elevated Stations",
    "s2_1_2_3": "2.1.2.3 Model DBR - Bored Tunnels",
    "s2_1_2_4": "2.1.2.4 Model DBR - Cut and Cover",
    "s2_1_3": "2.1.3 Track Structure - Annexure C1",
    "s2_1_4": "2.1.4 Fastening System - Annexure C2",
    "s2_1_5": "2.1.5 RDSO Rail Structure Interaction v2",
    "s2_2_1": "2.2.1 Rolling Stock Documents - Annexure A",
    "s2_3_1": "2.3.1 Rolling Stock Documents - Annexure B",
    "s2_3_2": "2.3.2 Traction & Power Supply - Annexure D1 & D2",
    "s2_4_1": "2.4.1 Signalling & Communication - Annexure E1 & E2",
    "s3_1": "3.1 Rolling Stock Fitness Certificate",
    "s3_2": "3.2 Track Fitness & Fastening Certificates",
    "s3_3": "3.3 Bridge & Structure Fitness Certificates",
    "s3_4": "3.4 Infringement of Moving and Fixed Dimension",
    "s3_5": "3.5 Calculation of Speed on Curve",
}

def document_to_out(doc: Document) -> Dict[str, Any]:
    data = {
        "id": doc.id,
        "filename": doc.filename,
        "metro_authority_name": doc.metro_authority_name,
        "status": doc.status,
        "page_count": doc.page_count,
        "version": doc.version,
        "section_id": doc.section_id,
        "section_label": SECTION_LABELS.get(doc.section_id or "", doc.section_id),
        "ai_result": None,
        "review_comment": doc.review_comment,
        "reviewed_by": doc.reviewed_by,
        "reviewed_at": doc.reviewed_at,
        "parent_document_id": doc.parent_document_id,
        "uploaded_at": doc.uploaded_at,
        "updated_at": doc.updated_at,
    }
    if doc.ai_result_json:
        try:
            data["ai_result"] = json.loads(doc.ai_result_json)
        except json.JSONDecodeError:
            pass
    return data

def get_section_rule_text(db: Session, section_id: str) -> str:
    rule = (
        db.query(SectionRule)
        .filter(SectionRule.section_id == section_id)
        .first()
    )

    if not rule:
        return ""

    return (rule.rule_text or "").strip()

def compliance_metadata(doc: Document, rules_text: str, mode: str) -> Dict[str, Any]:
    normalized = rules_text.strip()
    return {
        "documentId": doc.id,
        "sectionId": doc.section_id,
        "subsectionLabel": SECTION_LABELS.get(doc.section_id or "", doc.section_id),
        "rulesTextLength": len(normalized),
        "ruleCount": len([line for line in re.split(r"[\n.;]+", normalized) if line.strip()]),
        "aiMode": mode,
        "model": AI_COMPLIANCE_MODEL,
        "rulesPreview": normalized[:500],
        "reviewedAt": datetime.utcnow().isoformat(),
    }

def compact_for_prompt(text: str, limit: int) -> str:
    normalized = normalize_text(text or "")
    if len(normalized) <= limit:
        return normalized
    head = normalized[: limit // 2]
    tail = normalized[-(limit // 2):]
    return f"{head}\n\n[...middle omitted for faster AI review...]\n\n{tail}"

def focused_pdf_excerpt(pdf_text: str, rules_text: str, limit: int) -> str:
    normalized_pdf = normalize_text(pdf_text or "")
    if len(normalized_pdf) <= limit:
        return normalized_pdf
    rule_terms = [
        word.lower()
        for word in re.findall(r"[A-Za-z0-9.]+", rules_text or "")
        if len(word) > 5
    ][:30]
    lowered_pdf = normalized_pdf.lower()
    snippets = []
    for term in rule_terms:
        index = lowered_pdf.find(term)
        if index == -1:
            continue
        start = max(0, index - 450)
        end = min(len(normalized_pdf), index + 850)
        snippet = normalized_pdf[start:end]
        if snippet not in snippets:
            snippets.append(snippet)
        if sum(len(part) for part in snippets) >= limit:
            break
    if snippets:
        return compact_for_prompt("\n\n--- PDF EXCERPT ---\n\n".join(snippets), limit)
    return compact_for_prompt(normalized_pdf, limit)

def extract_code_references(text: str) -> List[str]:
    patterns = [
        r"IS\s*:?\s*1343(?:\s*(?:clause|cl\.?|table)\s*)?\s*\d+(?:\.\d+)*",
        r"IS\s*:?\s*2911(?:\s*(?:clause|cl\.?|part|table)\s*)?\s*\d*(?:\.\d+)*",
        r"IS\s*:?\s*4923",
        r"IS\s*:?\s*2062",
        r"IS\s*:?\s*1161",
        r"HYSD\s*14\.5\s*%",
    ]
    refs = []
    for pattern in patterns:
        refs.extend(match.group(0) for match in re.finditer(pattern, text or "", flags=re.IGNORECASE))
    return sorted(set(normalize_text(ref).lower().replace(" ", "") for ref in refs if ref.strip()))

def find_evidence_for_rule(rule_text: str, pdf_text: str) -> Optional[Dict[str, Any]]:
    normalized_pdf = normalize_text(pdf_text or "")
    lowered_pdf = normalized_pdf.lower()
    for ref in extract_code_references(rule_text):
        comparable_pdf = lowered_pdf.replace(" ", "")
        index = comparable_pdf.find(ref)
        if index == -1:
            continue
        loose_ref = ref.replace("is:", "is").replace("clause", "")
        loose_index = lowered_pdf.replace(" ", "").find(loose_ref)
        approx_index = max(0, loose_index if loose_index != -1 else 0)
        start = max(0, approx_index - 180)
        end = min(len(normalized_pdf), approx_index + 360)
        return {
            "quote": normalized_pdf[start:end].strip(),
            "highlightText": ref,
            "pageNumber": None,
        }
    rule_terms = [
        word.lower()
        for word in re.findall(r"[A-Za-z0-9.]+", rule_text or "")
        if len(word) > 5
    ][:6]
    if rule_terms and all(term in lowered_pdf for term in rule_terms[:3]):
        first = lowered_pdf.find(rule_terms[0])
        start = max(0, first - 180)
        end = min(len(normalized_pdf), first + 360)
        return {
            "quote": normalized_pdf[start:end].strip(),
            "highlightText": rule_terms[0],
            "pageNumber": None,
        }
    return None

def filter_false_positive_issues(doc: Document, result: Dict[str, Any], pdf_text: str, rules_text: str) -> Dict[str, Any]:
    remaining = []
    removed = []
    rule_blocks = [
        block.strip()
        for block in re.split(r"\n\s*\n|(?<=\.)\s+(?=[A-Z0-9])", rules_text or "")
        if block.strip()
    ]
    for issue in result.get("issues", []):
        candidate_text = " ".join([
            issue.get("ruleTitle", ""),
            issue.get("ruleId", ""),
            issue.get("explanation", ""),
        ])
        matching_rule = next((rule for rule in rule_blocks if any(ref in extract_code_references(rule) for ref in extract_code_references(candidate_text))), candidate_text)
        evidence = find_evidence_for_rule(matching_rule, pdf_text)
        if evidence and issue.get("issueType") in ["missing", "violation"]:
            removed.append({**issue, "evidence": evidence})
            continue
        if issue.get("issueType") == "violation" and not issue.get("matchedText"):
            issue["issueType"] = "needs_review"
            issue["severity"] = "medium"
            issue["explanation"] = (issue.get("explanation") or "Potential issue requires manual verification.") + " No direct violation evidence was returned by the model."
        remaining.append(issue)
    result["issues"] = remaining
    result["overallStatus"] = "violation_found" if any(i["issueType"] in ["missing", "violation"] for i in remaining) else ("needs_review" if remaining else "compliant")
    result.setdefault("metadata", {})
    result["metadata"]["falsePositiveCandidatesRemoved"] = len(removed)
    result["metadata"]["removedFindings"] = removed[:10]
    return result

def build_no_rules_result(doc: Document) -> Dict[str, Any]:
    """Return a clean result when no text rules have been uploaded for this section."""
    section_label = SECTION_LABELS.get(doc.section_id or "", doc.section_id or "")
    return {
        "pdfId": doc.id,
        "section": section_label.split(" ", 1)[0] if section_label else "",
        "subsection": section_label,
        "overallStatus": "pending_rules",
        "issues": [],
        "metadata": {
            **compliance_metadata(doc, "", "none"),
            "message": (
                "No text rules have been added for this subsection yet. "
                "Go to Rules → select this section → add a rule paragraph, then rerun AI review."
            ),
        },
    }


def build_ai_error_result(doc: Document, rules_text: str, error: str) -> Dict[str, Any]:
    """Return a clean result when the AI model call fails — no fabricated findings."""
    section_label = SECTION_LABELS.get(doc.section_id or "", doc.section_id or "")
    return {
        "pdfId": doc.id,
        "section": section_label.split(" ", 1)[0] if section_label else "",
        "subsection": section_label,
        "overallStatus": "ai_error",
        "issues": [],
        "metadata": {
            **compliance_metadata(doc, rules_text, "ollama"),
            "error": str(error),
            "message": (
                "The AI model could not complete the review. "
                "Please check that the Ollama service is running with the qwen3-coder:480b model loaded, "
                "then click 'Rerun AI Review'."
            ),
        },
    }

def normalize_compliance_result(doc: Document, raw: Dict[str, Any]) -> Dict[str, Any]:
    section_label = SECTION_LABELS.get(doc.section_id or "", doc.section_id or "")
    allowed_status = {"needs_review", "violation_found", "compliant", "pending_rules", "ai_error"}
    allowed_issue_types = {"missing", "violation", "needs_review"}
    allowed_severity = {"low", "medium", "high"}
    issues = []
    for item in raw.get("issues", []):
        if not isinstance(item, dict):
            continue
        issue_type = str(item.get("issueType") or "needs_review").lower()
        severity = str(item.get("severity") or "medium").lower()
        if issue_type not in allowed_issue_types:
            issue_type = "needs_review"
        if severity not in allowed_severity:
            severity = "medium"
        if issue_type == "compliant":
            continue
        issues.append({
            "ruleId": str(item.get("ruleId") or "").strip(),
            "ruleTitle": str(item.get("ruleTitle") or "").strip(),
            "issueType": issue_type,
            "severity": severity,
            "explanation": str(item.get("explanation") or "").strip(),
            "suggestedCorrection": str(item.get("suggestedCorrection") or "").strip(),
            "pageNumber": item.get("pageNumber") if isinstance(item.get("pageNumber"), int) else None,
            "matchedText": str(item.get("matchedText") or "").strip(),
            "highlightText": str(item.get("highlightText") or "").strip(),
        })
    overall = str(raw.get("overallStatus") or "").lower()
    if overall not in allowed_status:
        overall = "violation_found" if any(i["issueType"] in ["missing", "violation"] for i in issues) else ("needs_review" if issues else "compliant")
    return {
        "pdfId": doc.id,
        "section": str(raw.get("section") or section_label.split(" ", 1)[0] if section_label else ""),
        "subsection": str(raw.get("subsection") or section_label),
        "overallStatus": overall,
        "issues": issues,
        "metadata": compliance_metadata(doc, "", "ollama"),
    }

def build_compliance_prompt(
    doc: Document,
    pdf_text: str,
    rules_text: str
) -> str:

    section_label = SECTION_LABELS.get(
        doc.section_id or "",
        doc.section_id or ""
    )

    prompt_rules = compact_for_prompt(
        rules_text,
        AI_RULE_CHAR_LIMIT
    )

    prompt_pdf = pdf_text

    return f"""
You are the DBR Scrutiny AI for the UTHS Metro Rail Scrutiny System.

Your task is to compare the uploaded DBR ONLY against the supplied subsection rules.

STRICT INSTRUCTIONS

1. Use ONLY the supplied rules.

2. Use ONLY the supplied PDF text.

3. Do NOT create new rules.

4. Do NOT use engineering knowledge.

5. Do NOT use external standards.

6. Do NOT assume compliance.

7. If evidence is missing:
issueType = "missing"

8. If evidence contradicts the rule:
issueType = "violation"

9. If evidence is unclear:
issueType = "needs_review"

10. Do NOT report compliant items.

11. Do NOT fabricate page numbers.

12. Do NOT fabricate evidence.

13. Return JSON only.

14. If a requirement is not present in the supplied rules,
ignore it completely.

15. Every finding must reference a supplied rule.

16. Return at most {AI_MAX_ISSUES} issues.

Required JSON schema:

{{
  "pdfId": "{doc.id}",
  "section": "{section_label.split(" ", 1)[0] if section_label else ""}",
  "subsection": "{section_label}",
  "overallStatus": "needs_review | violation_found | compliant",
  "issues": [
    {{
      "ruleId": "string",
      "ruleTitle": "string",
      "issueType": "missing | violation | needs_review",
      "severity": "low | medium | high",
      "explanation": "string",
      "suggestedCorrection": "string",
      "pageNumber": null,
      "matchedText": "string",
      "highlightText": "string"
    }}
  ]
}}

====================================================
SUBSECTION RULES
====================================================

{prompt_rules}

====================================================
UPLOADED PDF TEXT
====================================================

{prompt_pdf}
"""

def run_ollama_compliance_review(doc: Document, pdf_text: str, rules_text: str) -> Dict[str, Any]:

    import ollama


    prompt = build_compliance_prompt(
        doc,
        pdf_text,
        rules_text
    )

    print("PROMPT LENGTH:", len(prompt))

    with open(
        "debug_prompt.txt",
        "w",
        encoding="utf-8"
    ) as f:
        f.write(prompt)

    print("PROMPT SAVED")

    response = ollama.chat(
        model=AI_COMPLIANCE_MODEL,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ],
        options={
            "temperature": 0,
            "top_p": 1,
            "num_predict": 32768
        },
    )

    print("OLLAMA RESPONSE RECEIVED")

    content = response["message"]["content"].strip()

    with open(
        "debug_response.txt",
        "w",
        encoding="utf-8"
    ) as f:
        f.write(content)

    print("RESPONSE SAVED")

    content = re.sub(
        r"^```(?:json)?",
        "",
        content,
        flags=re.IGNORECASE
    ).strip()

    content = re.sub(
        r"```$",
        "",
        content
    ).strip()

    first = content.find("{")
    last = content.rfind("}")

    if first >= 0 and last > first:
        content = content[first:last + 1]

    return normalize_compliance_result(
        doc,
        json.loads(content)
    )
def run_ai_compliance_review(doc: Document, contents: bytes, db: Session) -> Dict[str, Any]:

   

    try:
        pdf_text = extract_pdf_text(contents)

        print("\n================ PDF TEXT =================")
        print(pdf_text[:10000])
        print("\n================ END PDF =================")

    except HTTPException as exc:

        print("PDF EXTRACTION FAILED:", exc)

        pdf_text = ""

    rules_text = get_section_rule_text(
        db,
        doc.section_id or ""
    )

    print("\n================ RULES TEXT =================")
    print(rules_text[:5000])
    print("\n================ END RULES =================")

    if not rules_text.strip():

        print("NO RULES FOUND FOR SECTION")

        return build_no_rules_result(doc)

    try:

        print("ABOUT TO CALL OLLAMA")

        result = run_ollama_compliance_review(
            doc,
            pdf_text,
            rules_text
        )

        print("OLLAMA FINISHED")

        result["metadata"] = compliance_metadata(
            doc,
            rules_text,
            "ollama"
        )

        return result

    except Exception as exc:

        print("OLLAMA ERROR:", str(exc))

        return build_ai_error_result(
            doc,
            rules_text,
            exc
        )
def extract_uploaded_rule_text(file_name: str, contents: bytes) -> str:
    lower = file_name.lower()
    if lower.endswith(".txt"):
        return contents.decode("utf-8", errors="ignore")
    if lower.endswith(".docx"):
        return extract_docx_text(contents)
    if lower.endswith(".pdf"):
        return extract_pdf_text(contents)
    raise HTTPException(status_code=400, detail="Only TXT, PDF, and DOCX guideline files are supported")
 
def create_draft_rules_from_text(
    text: str,
    source_document: str,
    version: Optional[str],
    db: Session,
    admin: User,
) -> List[Rule]:
    pieces = split_rule_text(text)
    if not pieces:
        raise HTTPException(status_code=400, detail="No rules could be extracted from the submitted text")
    drafts = [build_draft_rule(piece, admin, source_document, version) for piece in pieces]
    for draft in drafts:
        db.add(draft)
    db.commit()
    for draft in drafts:
        db.refresh(draft)
    log_action(db, admin, "bulk_ingested", "rule", "bulk", f"Created {len(drafts)} draft rules from {source_document}")
    return drafts
 
@app.post("/rule-ingestion/bulk-paste", response_model=List[RuleOut], status_code=201)
def ingest_bulk_paste(payload: BulkPasteIngest, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    drafts = create_draft_rules_from_text(payload.text, payload.source_document or "Bulk paste", payload.version, db, admin)
    return [rule_to_out(rule) for rule in drafts]
 
@app.post("/rule-ingestion/upload", response_model=List[RuleOut], status_code=201)
async def ingest_rule_document(
    file: UploadFile = File(...),
    version: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    contents = await file.read()
    if len(contents) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Guideline file too large. Maximum 25 MB")
    text = extract_uploaded_rule_text(file.filename, contents)
    drafts = create_draft_rules_from_text(text, file.filename, version, db, admin)
    return [rule_to_out(rule) for rule in drafts]
 
@app.post("/rules/{rule_id}/approve", response_model=RuleOut)
def approve_rule(rule_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    rule = db.query(Rule).filter(Rule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    rule.status = RuleStatus.approved.value
    rule.is_active = True
    rule.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(rule)
    log_action(db, admin, "approved", "rule", rule_id, f"Approved rule {rule.clause_ref}")
    return rule_to_out(rule)
 
@app.post("/rules/bulk-approve", response_model=List[RuleOut])
def bulk_approve_rules(payload: BulkApprovalRequest, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if not payload.rule_ids:
        raise HTTPException(status_code=400, detail="No rule IDs supplied")
    rules = db.query(Rule).filter(Rule.id.in_(payload.rule_ids)).all()
    found_ids = {rule.id for rule in rules}
    missing = [rule_id for rule_id in payload.rule_ids if rule_id not in found_ids]
    if missing:
        raise HTTPException(status_code=404, detail=f"Rules not found: {', '.join(missing)}")
    for rule in rules:
        rule.status = RuleStatus.approved.value
        rule.is_active = True
        rule.updated_at = datetime.utcnow()
    db.commit()
    for rule in rules:
        db.refresh(rule)
    log_action(db, admin, "bulk_approved", "rule", "bulk", f"Approved {len(rules)} rules")
    return [rule_to_out(rule) for rule in rules]
 
# ── Documents Routes ───────────────────────────────────────────────────────
@app.get("/documents", response_model=List[DocumentOut])
def list_documents(
    q: Optional[str] = Query(None),
    status: Optional[DocumentStatus] = Query(None),
    metro_authority: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(Document)
    if q:
        needle = f"%{q.lower()}%"
        query = query.filter(or_(
            Document.filename.ilike(needle),
            Document.metro_authority_name.ilike(needle),
        ))
    if status:
        query = query.filter(Document.status == status)
    if metro_authority:
        query = query.filter(Document.metro_authority_name.ilike(f"%{metro_authority}%"))
    return [document_to_out(doc) for doc in query.order_by(Document.uploaded_at.desc()).all()]
 
@app.patch("/documents/{doc_id}/status")
def update_document_status(doc_id: str, status: DocumentStatus, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.status = status
    doc.updated_at = datetime.utcnow()
    db.commit()
    log_action(db, admin, "status_changed", "document", doc_id, f"Status → {status}")
    return {"message": "Status updated"}

@app.get("/sections")
def list_sections(_: User = Depends(get_current_user)):
    return [{"id": section_id, "label": label} for section_id, label in SECTION_LABELS.items()]

@app.get("/review-documents", response_model=List[DocumentOut])
def list_review_documents(
    db: Session = Depends(get_db),
    _: User = Depends(require_officer_or_admin),
):
    docs = db.query(Document).order_by(Document.uploaded_at.desc()).all()
    return [document_to_out(doc) for doc in docs]

@app.get("/review-documents/{doc_id}", response_model=DocumentOut)
def get_review_document(
    doc_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_officer_or_admin),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return document_to_out(doc)

@app.get("/documents/{doc_id}/pdf")
def stream_document_pdf(
    doc_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if current_user.role == UserRole.metro_authority and doc.metro_authority_id != current_user.id:
        raise HTTPException(status_code=403, detail="Document access denied")
    if not doc.s3_key or not os.path.exists(doc.s3_key):
        raise HTTPException(status_code=404, detail="PDF file missing from disk")
    return FileResponse(
        path=doc.s3_key,
        media_type="application/pdf",
        filename=doc.filename,
        headers={"Content-Disposition": f'inline; filename="{doc.filename}"'},
    )

@app.post("/review-documents/{doc_id}/decision", response_model=DocumentOut)
def save_review_decision(
    doc_id: str,
    payload: ReviewDecision,
    db: Session = Depends(get_db),
    officer: User = Depends(require_officer_or_admin),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if payload.decision not in ["approved", "flagged"]:
        raise HTTPException(status_code=400, detail="Decision must be approved or flagged")
    if payload.decision == "flagged" and not (payload.comment or "").strip():
        raise HTTPException(status_code=400, detail="Flagged documents require a comment")
    doc.status = DocumentStatus.approved if payload.decision == "approved" else DocumentStatus.flagged
    doc.review_comment = payload.comment
    doc.reviewed_by = officer.name
    doc.reviewed_at = datetime.utcnow()
    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    log_action(db, officer, payload.decision, "document_review", doc_id, payload.comment or f"Document {payload.decision}")
    return document_to_out(doc)

@app.post("/review-documents/{doc_id}/rerun-ai", response_model=DocumentOut)
def rerun_document_ai_review(
    doc_id: str,
    db: Session = Depends(get_db),
    officer: User = Depends(require_officer_or_admin),
):

    print("====================================")
    print("RERUN ENDPOINT HIT")
    print("DOC ID =", doc_id)
    print("====================================")

    doc = db.query(Document).filter(Document.id == doc_id).first()

    

    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Document not found"
        )

    if not doc.section_id:
        raise HTTPException(
            status_code=400,
            detail="Document has no subsection selected"
        )

    if not doc.s3_key or not os.path.exists(doc.s3_key):
        raise HTTPException(
            status_code=404,
            detail="PDF file missing from disk"
        )

    print("SECTION =", doc.section_id)
    print("FILE =", doc.s3_key)

    with open(doc.s3_key, "rb") as file:
        contents = file.read()

  
    print("PDF SIZE =", len(contents))

    result = run_ai_compliance_review(
        doc,
        contents,
        db
    )

   

    doc.ai_result_json = json.dumps(result)


    doc.status = DocumentStatus.under_scrutiny
    doc.review_comment = None
    doc.reviewed_by = None
    doc.reviewed_at = None
    doc.updated_at = datetime.utcnow()

    db.commit()

   

    db.refresh(doc)

   

    log_action(
        db,
        officer,
        "reran_ai_review",
        "document",
        doc_id,
        f"Reran AI review using rules for {doc.section_id}"
    )



    return document_to_out(doc)

# ── Users Routes ───────────────────────────────────────────────────────────
@app.get("/users", response_model=List[UserOut])
def list_users(
    q: Optional[str] = Query(None),
    role: Optional[UserRole] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(User)
    if q:
        needle = f"%{q.lower()}%"
        query = query.filter(or_(
            User.name.ilike(needle),
            User.email.ilike(needle),
        ))
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    return query.order_by(User.created_at.desc()).all()
 
@app.post("/users", response_model=UserOut, status_code=201)
def create_user(user: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    new_user = User(name=user.name, email=user.email, hashed_password=hash_password(user.password), role=user.role)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    log_action(db, admin, "created", "user", new_user.id, f"Created {user.role}: {user.name}")
    return new_user
 
@app.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, update: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    for field, value in update.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    log_action(db, admin, "updated", "user", user_id, f"Updated user {user.name}")
    return user
 
@app.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    log_action(db, admin, "deleted", "user", user_id, f"Deleted {user.name}")
    db.delete(user)
    db.commit()
 
# ── Audit Log Routes ───────────────────────────────────────────────────────
@app.get("/audit-logs", response_model=List[AuditLogOut])
def list_audit_logs(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(200).all()
 
# ── Stats ──────────────────────────────────────────────────────────────────
@app.get("/stats")
def get_stats(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    total_docs = db.query(Document).count()
    total_rules = db.query(Rule).count()
    active_rules = db.query(Rule).filter(Rule.is_active == True, Rule.status == RuleStatus.approved.value).count()
    draft_rules = db.query(Rule).filter(Rule.status == RuleStatus.draft.value).count()
    total_users = db.query(User).count()
    docs_by_status = {}
    for status in DocumentStatus:
        docs_by_status[status.value] = db.query(Document).filter(Document.status == status).count()
    users_by_role = {}
    for role in UserRole:
        users_by_role[role.value] = db.query(User).filter(User.role == role).count()
    return {
        "total_documents": total_docs,
        "total_rules": total_rules,
        "active_rules": active_rules,
        "draft_rules": draft_rules,
        "total_users": total_users,
        "documents_by_status": docs_by_status,
        "users_by_role": users_by_role,
    }
 
# ── Upload directory ───────────────────────────────────────────────────────
import shutil
 
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
 
SECTION_PDF_DIR = "section_pdfs"
os.makedirs(SECTION_PDF_DIR, exist_ok=True)

RULE_PDF_DIR = "rule_pdfs"
os.makedirs(RULE_PDF_DIR, exist_ok=True)

RULE_PDF_SECTION_MAP = {
    "Criteria_for_osc_1.pdf": "s1_1",
    "modified_criteria.pdf": "s1_3",
    "Metro_Manual_December_2015.pdf": "s1_2",
    "GUIDELINES_FOR_FRAMING_SOD.pdf": "s2_1_1",
    "MODEL_DBR_FOR_VIADUCTS.pdf": "s2_1_2_1",
    "MODEL_DBR_ELEVATED_STATIONS.pdf": "s2_1_2_2",
    "DBR_BORED_TUNNELS.pdf": "s2_1_2_3",
    "ModelDBR4CutAndCover.pdf": "s2_1_2_4",
    "Format_C1.pdf": "s2_1_3",
    "Annex_C2.pdf": "s2_1_4",
    "RDSO_RSI_Version_2.pdf": "s2_1_5",
    "Digitally_Signed_Annexure_A.pdf": "s2_2_1",
    "Format_Annexure_B.pdf": "s2_3_1",
    "Annexure_D1D2.pdf": "s2_3_2",
    "Annexure_E1E2.pdf": "s2_4_1",
}

def seed_rule_pdf_folder():
    with SessionLocal() as db:
        system_user = db.query(User).filter(User.email == "admin@uths.gov.in").first()
        uploaded_by = system_user.id if system_user else "system"
        changed = False
        for filename, section_id in RULE_PDF_SECTION_MAP.items():
            path = os.path.join(RULE_PDF_DIR, filename)
            if not os.path.exists(path):
                continue
            existing = db.query(SectionPdf).filter(
                SectionPdf.section_id == section_id,
                SectionPdf.name == filename,
            ).first()
            if existing:
                current_size = os.path.getsize(path)
                if existing.path != path or existing.size_bytes != current_size:
                    existing.path = path
                    existing.size_bytes = current_size
                    changed = True
                continue
            db.add(SectionPdf(
                section_id=section_id,
                name=filename,
                path=path,
                size_bytes=os.path.getsize(path),
                uploaded_by=uploaded_by,
            ))
            changed = True
        if changed:
            db.commit()

seed_rule_pdf_folder()
 
# ── Section Rules Routes ───────────────────────────────────────────────────
 
def _section_rule_to_out(rule: SectionRule, pdfs: list) -> dict:
    return {
        "section_id": rule.section_id,
        "rule_text":  rule.rule_text,
        "pdfs": [
            {
                "id":          p.id,
                "section_id":  p.section_id,
                "name":        p.name,
                "size_bytes":  p.size_bytes,
                "uploaded_at": p.uploaded_at,
            }
            for p in pdfs
        ],
        "updated_at": rule.updated_at,
    }
 
 
@app.get("/section-rules")
def list_section_rules(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return all sections that have rule text or at least one PDF."""
    rules = db.query(SectionRule).all()
    all_pdfs = db.query(SectionPdf).all()
 
    pdf_map: Dict[str, list] = {}
    for p in all_pdfs:
        pdf_map.setdefault(p.section_id, []).append(p)
 
    result = []
    for rule in rules:
        pdfs = pdf_map.get(rule.section_id, [])
        result.append(_section_rule_to_out(rule, pdfs))
 
    # Surface section_ids that only have PDFs (no rule_text row yet)
    rule_ids = {r.section_id for r in rules}
    for sid, pdfs in pdf_map.items():
        if sid not in rule_ids:
            result.append({
                "section_id": sid,
                "rule_text":  None,
                "pdfs": [
                    {
                        "id":          p.id,
                        "section_id":  p.section_id,
                        "name":        p.name,
                        "size_bytes":  p.size_bytes,
                        "uploaded_at": p.uploaded_at,
                    }
                    for p in pdfs
                ],
                "updated_at": None,
            })
 
    return result
 
 
@app.put("/section-rules/{section_id}")
def upsert_section_rule(
    section_id: str,
    payload: SectionRuleUpsert,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Create or update the rule paragraph for a section."""
    rule = db.query(SectionRule).filter(SectionRule.section_id == section_id).first()
    if rule:
        rule.rule_text  = payload.rule_text
        rule.updated_at = datetime.utcnow()
    else:
        rule = SectionRule(
            section_id = section_id,
            rule_text  = payload.rule_text,
            created_by = admin.id,
        )
        db.add(rule)
    db.commit()
    db.refresh(rule)
    pdfs = db.query(SectionPdf).filter(SectionPdf.section_id == section_id).all()
    log_action(db, admin, "upserted", "section_rule", section_id,
               f"Rule text updated for section {section_id}")
    return _section_rule_to_out(rule, pdfs)
 
 
@app.post("/section-rules/{section_id}/pdfs", status_code=201)
async def upload_section_pdfs(
    section_id: str,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Attach one or more PDFs to a section (multipart field name: files)."""
    saved = []
    for file in files:
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"{file.filename} is not a PDF")
        contents = await file.read()
        if len(contents) > 100 * 1024 * 1024:
            raise HTTPException(status_code=400, detail=f"{file.filename} exceeds 100 MB limit")
        pdf_id = str(uuid.uuid4())
        safe   = file.filename.replace(" ", "_")
        path   = os.path.join(SECTION_PDF_DIR, f"{pdf_id}_{safe}")
        with open(path, "wb") as f:
            f.write(contents)
        record = SectionPdf(
            id          = pdf_id,
            section_id  = section_id,
            name        = file.filename,
            path        = path,
            size_bytes  = len(contents),
            uploaded_by = admin.id,
        )
        db.add(record)
        saved.append(record)
    db.commit()
    log_action(db, admin, "uploaded", "section_pdf", section_id,
               f"Attached {len(saved)} PDF(s) to section {section_id}")
    return [
        {
            "id":          p.id,
            "section_id":  p.section_id,
            "name":        p.name,
            "size_bytes":  p.size_bytes,
            "uploaded_at": p.uploaded_at,
        }
        for p in saved
    ]
 
 
@app.get("/section-pdfs/{pdf_id}")
def get_section_pdf(
    pdf_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Stream a PDF file inline for browser rendering."""
    record = db.query(SectionPdf).filter(SectionPdf.id == pdf_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="PDF not found")
    if not os.path.exists(record.path):
        raise HTTPException(status_code=404, detail="PDF file missing from disk")
    return FileResponse(
        path       = record.path,
        media_type = "application/pdf",
        filename   = record.name,
        headers    = {"Content-Disposition": f'inline; filename="{record.name}"'},
    )
 
 
@app.delete("/section-pdfs/{pdf_id}", status_code=204)
def delete_section_pdf(
    pdf_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Remove a PDF record and its file from disk."""
    record = db.query(SectionPdf).filter(SectionPdf.id == pdf_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="PDF not found")
    if os.path.exists(record.path):
        os.remove(record.path)
    db.delete(record)
    db.commit()
    log_action(db, admin, "deleted", "section_pdf", pdf_id,
               f"Removed PDF {record.name} from section {record.section_id}")
 
# ── Metro Authority helpers ────────────────────────────────────────────────
def require_metro_authority(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.metro_authority:
        raise HTTPException(status_code=403, detail="Metro Authority access required")
    return current_user
 
# ── Metro Authority: list own documents ────────────────────────────────────
@app.get("/metro-authority/documents", response_model=List[DocumentOut])
def metro_authority_list_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_metro_authority)
):
    docs = (
        db.query(Document)
        .filter(Document.metro_authority_id == current_user.id)
        .order_by(Document.uploaded_at.desc())
        .all()
    )
    return [document_to_out(doc) for doc in docs]
 
# ── Metro Authority: upload new document ───────────────────────────────────
@app.post("/metro-authority/upload", response_model=DocumentOut, status_code=201)
async def metro_authority_upload(
    section_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_metro_authority)
):
    if section_id not in SECTION_LABELS:
        raise HTTPException(status_code=400, detail="Select a valid subsection")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    contents = await file.read()
    if len(contents) > 500 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum 500 MB")
    doc_id = str(uuid.uuid4())
    safe   = file.filename.replace(" ", "_")
    path   = os.path.join(UPLOAD_DIR, f"{doc_id}_{safe}")
    with open(path, "wb") as f:
        f.write(contents)
    new_doc = Document(
        id=doc_id, filename=file.filename,
        metro_authority_id=current_user.id, metro_authority_name=current_user.name,
        status=DocumentStatus.under_scrutiny, s3_key=path, version=1,
        section_id=section_id,
    )
    db.add(new_doc)
    db.flush()
    new_doc.ai_result_json = json.dumps(run_ai_compliance_review(new_doc, contents, db))
    db.commit()
    db.refresh(new_doc)
    log_action(db, current_user, "uploaded", "document", doc_id,
               f"Uploaded {file.filename} ({round(len(contents)/1024/1024,2)} MB)")
    return document_to_out(new_doc)
 
# ── Metro Authority: resubmit ─────────────────────────────────────────────
@app.post("/metro-authority/documents/{doc_id}/resubmit", response_model=DocumentOut)
async def metro_authority_resubmit(
    doc_id: str,
    section_id: Optional[str] = None,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_metro_authority)
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.metro_authority_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status != DocumentStatus.needs_correction:
        if doc.status != DocumentStatus.flagged:
            raise HTTPException(status_code=400, detail="Only flagged documents can be resubmitted")
    if section_id and section_id not in SECTION_LABELS:
        raise HTTPException(status_code=400, detail="Select a valid subsection")
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    contents    = await file.read()
    new_version = doc.version + 1
    safe        = file.filename.replace(" ", "_")
    path        = os.path.join(UPLOAD_DIR, f"{doc_id}_v{new_version}_{safe}")
    with open(path, "wb") as f:
        f.write(contents)
    doc.filename   = file.filename
    doc.s3_key     = path
    doc.version    = new_version
    doc.section_id = section_id or doc.section_id
    doc.status     = DocumentStatus.under_scrutiny
    doc.review_comment = None
    doc.reviewed_by = None
    doc.reviewed_at = None
    doc.ai_result_json = json.dumps(run_ai_compliance_review(doc, contents, db))
    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    log_action(db, current_user, "resubmitted", "document", doc_id,
               f"Resubmitted as v{new_version}: {file.filename}")
    return document_to_out(doc)
 
# ── Metro Authority: view active rules (read-only) ────────────────────────
@app.get("/metro-authority/rules")
def metro_authority_get_rules(
    db: Session = Depends(get_db),
    _: User = Depends(require_metro_authority)
):
    rules = db.query(Rule).filter(Rule.is_active == True, Rule.status == RuleStatus.approved.value).all()
    return [{"id": r.id, "clause_ref": r.clause_ref,
             "category": r.category, "rule_text": r.rule_text} for r in rules]