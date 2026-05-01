#!/usr/bin/env python3
"""
从「复习版」Markdown / PDF 抽取讲义中的「練習」完形段落。
复习 PDF 多数章节无数码空格练习；Markdown 当前仅第12章含 ### 練習。
输出 JSON 供 build-practice-data.mjs 合并。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MD_DIR = ROOT / "n1n2语法_复习版_markdown_语音"
PDF_DIR = ROOT / "n1n2语法_复习版_pdf"
OUT = Path(__file__).resolve().parents[1] / "review-cloze.json"


def strip_md_html(s: str) -> str:
    s = re.sub(r"<button\b[^>]*>.*?</button>", "", s, flags=re.I | re.S)
    s = re.sub(r"<span\b[^>]*>", "", s, flags=re.I)
    s = re.sub(r"</span>", "", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return s


def chapter_no_from_name(name: str) -> int | None:
    m = re.search(r"第(\d+)章", name)
    return int(m.group(1)) if m else None


def extract_md_cloze(text: str, source: str) -> dict | None:
    """### 練習 … 直到 ### 复习提示 或下一个 ## / ###。"""
    if not re.search(r"^###\s*練習\s*$", text, re.M):
        return None
    text = strip_md_html(text)
    m = re.search(r"^###\s*練習\s*$", text, re.M)
    assert m
    start = m.end()
    rest = text[start:]
    stop = re.search(r"\n(?:###\s*复习提示\b|##\s+[^#\n]+)", rest)
    block = rest[: stop.start()].strip() if stop else rest.strip()
    ans_line = ""
    am = re.search(r"（解答[^）]*）\s*$", block, re.M)
    if am:
        ans_line = am.group(0).strip()
        block = block[: am.start()].strip()
    return {
        "source": source,
        "title": "練習（复习讲义）",
        "body": block,
        "answers": ans_line or "（参见讲义 PDF）",
    }


def extract_pdf_cloze_if_any(text: str, source: str) -> dict | None:
    """若全文含完形空格，截取練習附近片段（复习 PDF 多数章为空）。"""
    if "＿＿" not in text and "＿＿＿" not in text:
        return None
    # 取第一个含下划线块的段落
    idx = text.find("＿")
    pre = text[max(0, idx - 800) : idx]
    lm = list(re.finditer(r"(練習|問題)", pre))
    if lm:
        cut = lm[-1].start()
        snip_start = max(0, idx - 800 + cut)
    else:
        snip_start = max(0, idx - 400)
    tail = text[idx : idx + 2500]
    block = text[snip_start : idx + len(tail)].strip()
    ans_m = re.search(r"（解答[^）]{0,80}）", block)
    answers = ans_m.group(0).strip() if ans_m else ""
    body = block[: ans_m.start()].strip() if ans_m else block
    return {"source": source, "title": sec_title, "body": body, "answers": answers or "（参见讲义）"}


def main() -> None:
    chapters: list[dict] = []

    if MD_DIR.is_dir():
        for md in sorted(MD_DIR.glob("n1n2语法第*_复习.md")):
            raw = md.read_text(encoding="utf-8")
            ch = chapter_no_from_name(md.name)
            cloze = extract_md_cloze(raw, md.name)
            if cloze:
                chapters.append({"chapterNo": ch, "chapterTitle": md.stem, **cloze})

    try:
        import pymupdf  # type: ignore
    except ImportError:
        pymupdf = None

    md_chapters = {c["chapterNo"] for c in chapters}

    if pymupdf and PDF_DIR.is_dir():
        for pdf in sorted(PDF_DIR.glob("n1n2语法第*_复习.pdf")):
            ch = chapter_no_from_name(pdf.name)
            doc = pymupdf.open(str(pdf))
            full = "".join(doc[i].get_text() for i in range(len(doc)))
            doc.close()
            cloze = extract_pdf_cloze_if_any(full, pdf.name)
            if cloze and ch not in md_chapters:
                chapters.append({"chapterNo": ch, "chapterTitle": pdf.stem, **cloze})

    chapters.sort(key=lambda x: (x.get("chapterNo") or 999, x["source"]))
    payload = {"builtFrom": "extract_review_cloze.py", "chapters": chapters}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT} ({len(chapters)} sections)")


if __name__ == "__main__":
    main()
