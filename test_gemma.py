import fitz
import requests
import json
import pytesseract
from PIL import Image
import io

# ==========================================
# CONFIG
# ==========================================

MODEL = "qwen3-coder:480b-cloud"

RULES_FILE = "text2.txt"
DBR_FILE = r"model_dbr\DBR 2.pdf"

OLLAMA_URL = "http://localhost:11434/api/generate"

# Tesseract
pytesseract.pytesseract.tesseract_cmd = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

# ==========================================
# PDF EXTRACTION WITH OCR FALLBACK
# ==========================================

def extract_pdf_text(pdf_path):

    try:

        doc = fitz.open(pdf_path)

        pages = []

        total_pages = len(doc)

        for page_num in range(total_pages):

            page = doc[page_num]

            text = page.get_text().strip()

            if len(text.strip()) < 50:

                print(
                    f"[OCR] Page {page_num + 1}/{total_pages}"
                )

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

                print(
                    f"[TEXT] Page {page_num + 1}/{total_pages}"
                )

            pages.append(
                f"\n\n=== PAGE {page_num + 1} ===\n{text}"
            )

        doc.close()

        return "\n".join(pages)

    except Exception as e:

        print(f"\nERROR READING PDF: {pdf_path}")
        print(e)

        return ""

# ==========================================
# LOAD RULES TXT
# ==========================================

print("\nLoading Rules TXT...")

with open(
    RULES_FILE,
    "r",
    encoding="utf-8"
) as f:

    rules_text = f.read()

with open(
    "rules_extracted.txt",
    "w",
    encoding="utf-8"
) as f:

    f.write(rules_text)

# ==========================================
# EXTRACT DBR PDF
# ==========================================

print("\nExtracting DBR PDF...")

dbr_text = extract_pdf_text(DBR_FILE)

with open(
    "dbr_extracted.txt",
    "w",
    encoding="utf-8"
) as f:

    f.write(dbr_text)

# ==========================================
# VALIDATION
# ==========================================

print("\n====================================")
print(f"Rules Length : {len(rules_text)}")
print(f"DBR Length   : {len(dbr_text)}")
print("====================================")

if len(rules_text.strip()) == 0:
    raise Exception(
        "Rules file is empty."
    )

if len(dbr_text.strip()) == 0:
    raise Exception(
        "No text extracted from DBR."
    )

# ==========================================
# PROMPT
# ==========================================

prompt = f"""
You are the DBR Scrutiny AI for the UTHS Metro Rail Scrutiny System.

Your job:
You receive:

(a) admin-approved scrutiny rules
(b) the full DBR text

Use ONLY the supplied rules.
Use ONLY the supplied DBR.

RULE METADATA

- polarity:
  * must_include
  * must_exclude
  * must_match_model

- match_mode:
  * semantic
  * exact
  * code_ref

HARD RULES

1. Evaluate EACH rule independently.

2. Count ONLY entries that contain:
   Rule ID:

3. Do NOT create additional rules from:
   - section headings
   - notes
   - applicability statements
   - expected values
   - severity fields
   - explanatory text

4. Include in findings ONLY:
   - violation
   - missing
   - needs_review

5. Do NOT include:
   - compliant
   - not_applicable

6. If a rule requires a numeric threshold,
   the numeric value must explicitly exist in the DBR.

7. Do NOT infer compliance.

8. Do NOT assume compliance.

9. Do NOT use:
   - implied
   - inferred
   - likely
   - probably
   - assumed
   - suggests
   - indicates

10. If evidence is absent:
    status = missing

11. If evidence is ambiguous:
    status = needs_review

12. If evidence contradicts the rule:
    status = violation

13. Every finding MUST contain evidence.

14. Never fabricate evidence.

15. Never fabricate page numbers.

16. Return exactly one finding per Rule ID internally.

17. Summary counts must include ALL evaluated rules.

OUTPUT REQUIREMENTS

Return ONLY valid JSON.

Required top-level fields:

- document_id
- model_version
- summary
- findings

summary must contain:

- total_rules
- compliant
- violations
- missing
- not_applicable
- needs_review
- actionable_findings

findings must contain ONLY:

- violation
- missing
- needs_review

====================================================
RULES
====================================================

{rules_text}

====================================================
DBR CONTENT
====================================================

{dbr_text}

====================================================
TASK
====================================================

Evaluate all Rule IDs.

Return ONLY valid JSON.

No markdown.
No code fences.
No explanation.
"""

# ==========================================
# CALL MODEL
# ==========================================

print("\nRunning scrutiny...\n")

response = requests.post(
    OLLAMA_URL,
    json={
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0,
            "num_predict": 32768
        }
    },
    timeout=1800
)

print("HTTP Status:", response.status_code)

response.raise_for_status()

data = response.json()

result = data["response"]

# ==========================================
# SAVE RESULT
# ==========================================

with open(
    "scrutiny_result.json",
    "w",
    encoding="utf-8"
) as f:

    f.write(result)

print("\nRESULT SAVED")
print("File: scrutiny_result.json")

print("\n====================================")
print(result[:5000])