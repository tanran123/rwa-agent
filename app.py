#!/usr/bin/env python3
"""Standalone market-risk RWA service. Run from this directory or as a script path."""

from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import uuid
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))


def _load_local_env() -> None:
    for env_path in (APP_DIR.parent / ".env", APP_DIR / ".env"):
        if not env_path.is_file():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


_load_local_env()

from flask import Flask, jsonify, request, send_file, send_from_directory

from rwa_agent.agent import field_catalog, inspect_workbook, list_type_columns, run_with_mappings, write_rwa_workbook
from rwa_agent.compare import compare_module, module_catalog, write_comparison
from rwa_agent.library import calculation_rules, ensure_library, load_library, reset_rule, save_rule
from rwa_agent.rule_graph import load_graph, save_graph
from rwa_agent.mapper import suggest_mappings
from rwa_agent.rule_chat import discuss_rules
from rwa_agent.rule_learn import learn_from_excel
from rwa_agent.weight_tables import ingest_weight_workbook, weight_catalog

ensure_library()

WEB_DIR = APP_DIR / "web"
MAX_UPLOAD_MB = 120

app = Flask(__name__, static_folder=str(WEB_DIR), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024

# upload_id -> (workbook path, work dir, original filename)
UPLOADS: dict[str, tuple[Path, Path, str]] = {}
# upload_id -> exposure grid from the latest detail calculation
EXPOSURES: dict[str, dict] = {}


def _ingest_weights(path: Path, filename: str) -> dict:
    try:
        return ingest_weight_workbook(path, filename)
    except Exception:
        return {"added": False, "duplicate": False, "filename": filename}


def _result_suffix(filename: str) -> str:
    return ".xlsm" if filename.lower().endswith(".xlsm") else ".xlsx"


def _result_name(filename: str) -> str:
    stem = Path(filename).stem or "结果"
    stem = re.sub(r"[\\/:*?\"<>|]+", "_", stem).strip()[:80] or "结果"
    return f"{stem}_计算RWA{_result_suffix(filename)}"


def _result_path(work_dir: Path, filename: str) -> Path:
    return work_dir / ("calculated" + _result_suffix(filename))


@app.get("/")
def index():
    response = send_from_directory(WEB_DIR, "index.html")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "rwa"})


@app.get("/api/fields")
def fields():
    return jsonify({"packs": field_catalog()})


@app.post("/api/inspect")
def inspect():
    upload = request.files.get("file")
    if upload is None or upload.filename == "":
        return jsonify({"error": "请先选择要上传的 Excel 文件"}), 400
    name = upload.filename or ""
    if not name.lower().endswith((".xlsx", ".xlsm")):
        return jsonify({"error": "仅支持 .xlsx 或 .xlsm 格式"}), 400
    work_dir = Path(tempfile.mkdtemp(prefix="rwa_map_"))
    input_path = work_dir / "input.xlsx"
    upload.save(input_path)
    upload_id = uuid.uuid4().hex
    UPLOADS[upload_id] = (input_path, work_dir, name)
    try:
        preview = inspect_workbook(input_path)
        preview["weights"] = _ingest_weights(input_path, name)
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        UPLOADS.pop(upload_id, None)
        return jsonify({"error": f"读取失败: {e}"}), 500
    preview["upload_id"] = upload_id
    preview["filename"] = name
    return jsonify(preview)


@app.post("/api/types")
def types():
    data = request.get_json(silent=True) or {}
    upload_id = str(data.get("upload_id") or "")
    stored = UPLOADS.get(upload_id)
    if stored is None:
        return jsonify({"error": "请重新上传文件"}), 400
    sheet = str(data.get("sheet") or "")
    try:
        header_row = int(data.get("header_row"))
    except (TypeError, ValueError):
        return jsonify({"error": "表头行无效"}), 400
    try:
        columns = list_type_columns(stored[0], sheet, header_row)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"读取失败: {e}"}), 500
    return jsonify({"type_columns": columns})


@app.post("/api/suggest")
def suggest():
    data = request.get_json(silent=True) or {}
    upload_id = str(data.get("upload_id") or "")
    stored = UPLOADS.get(upload_id)
    if stored is None:
        return jsonify({"error": "请重新上传文件"}), 400
    products = data.get("products")
    if not isinstance(products, list) or not products:
        return jsonify({"error": "请先选择计算方式"}), 400
    sheet = str(data.get("sheet") or "")
    try:
        header_row = int(data.get("header_row"))
    except (TypeError, ValueError):
        return jsonify({"error": "表头行无效"}), 400
    try:
        mappings = suggest_mappings(stored[0], sheet, header_row, [str(item) for item in products])
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"mappings": mappings})


@app.get("/api/weights")
def weights():
    return jsonify(weight_catalog())


@app.get("/api/rules")
def rules_library():
    try:
        library = load_library()
    except Exception as e:
        return jsonify({"error": f"读取规则失败: {e}"}), 500
    return jsonify({"rules": library})


@app.get("/api/rules/graph")
def rules_graph_get():
    return jsonify({"graph": load_graph()})


@app.put("/api/rules/graph")
def rules_graph_save():
    data = request.get_json(silent=True) or {}
    try:
        graph = save_graph(data.get("graph"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"写入图谱失败: {e}"}), 500
    return jsonify({"graph": graph})


@app.put("/api/rules")
def rules_save():
    data = request.get_json(silent=True) or {}
    pack = str(data.get("id") or "")
    try:
        if data.get("reset"):
            rule = reset_rule(pack)
        else:
            rule = save_rule(pack, data.get("rule"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"写入规则失败: {e}"}), 500
    return jsonify({"rule": rule})


@app.post("/api/rules/learn")
def rules_learn():
    upload = request.files.get("file")
    if upload is None or upload.filename == "":
        return jsonify({"error": "请先选择规则 Excel"}), 400
    name = upload.filename or ""
    if not name.lower().endswith((".xlsx", ".xlsm")):
        return jsonify({"error": "规则 Excel 仅支持 .xlsx 或 .xlsm"}), 400
    upload.seek(0, os.SEEK_END)
    size = upload.tell()
    upload.seek(0)
    if size > 15 * 1024 * 1024:
        return jsonify({"error": "规则 Excel 请小于 15MB"}), 400
    work_dir = Path(tempfile.mkdtemp(prefix="rwa_rule_"))
    input_path = work_dir / "rules.xlsx"
    try:
        upload.save(input_path)
        weights = _ingest_weights(input_path, name)
        result = learn_from_excel(input_path, name)
        result["weights"] = weights
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    return jsonify(result)


@app.post("/api/rules/chat")
def rules_chat():
    data = request.get_json(silent=True) or {}
    try:
        result = discuss_rules(data.get("messages"), data.get("rules"), data.get("focus"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(result)


@app.get("/api/modules")
def modules():
    return jsonify({"modules": module_catalog()})


@app.post("/api/calculate")
def calculate():
    data = request.get_json(silent=True) or {}
    upload_id = str(data.get("upload_id") or "")
    stored = UPLOADS.get(upload_id)
    if stored is None:
        return jsonify({"error": "请重新上传文件"}), 400
    specs = data.get("tables")
    if not isinstance(specs, list) or not specs:
        return jsonify({"error": "请至少添加一张计算表并对应表头"}), 400
    try:
        result = run_with_mappings(stored[0], specs, calculation_rules())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"处理失败: {e}"}), 500
    rows = result.pop("rwa_rows", [])
    original = stored[2] if len(stored) > 2 else "结果.xlsx"
    out_path = _result_path(stored[1], original)
    try:
        write_rwa_workbook(stored[0], out_path, rows)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"写出 Excel 失败: {e}"}), 500
    result["download_url"] = f"/api/result/{upload_id}"
    result["download_name"] = _result_name(original)
    exposure = result.get("exposure") or {"currencies": []}
    exposure["module"] = str(data.get("module") or "")
    EXPOSURES[upload_id] = exposure
    return jsonify(result)


@app.post("/api/compare")
def compare():
    upload_id = str(request.form.get("upload_id") or "")
    stored = UPLOADS.get(upload_id)
    exposure = EXPOSURES.get(upload_id)
    if stored is None or exposure is None:
        return jsonify({"error": "请先上传明细并完成计算"}), 400
    upload = request.files.get("file")
    if upload is None or upload.filename == "":
        return jsonify({"error": "请上传监管结果"}), 400
    name = upload.filename or ""
    if not name.lower().endswith((".xlsx", ".xlsm")):
        return jsonify({"error": "监管结果仅支持 .xlsx 或 .xlsm"}), 400
    reg_path = stored[1] / "regulatory.xlsx"
    upload.save(reg_path)
    try:
        module = str(request.form.get("module") or "")
        comparison = compare_module(module, exposure, reg_path)
        dest = stored[1] / "comparison.xlsx"
        write_comparison(dest, comparison)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"对比失败: {e}"}), 500
    comparison["download_url"] = f"/api/compare/{upload_id}"
    comparison["download_name"] = _compare_name(stored[2] if len(stored) > 2 else "结果.xlsx")
    return jsonify(comparison)


@app.get("/api/compare/<upload_id>")
def compare_file(upload_id: str):
    stored = UPLOADS.get(upload_id)
    if stored is None:
        return jsonify({"error": "请重新上传文件"}), 400
    path = stored[1] / "comparison.xlsx"
    if not path.is_file():
        return jsonify({"error": "还没有可下载的对比结果"}), 404
    name = _compare_name(stored[2] if len(stored) > 2 else "结果.xlsx")
    return send_file(path, as_attachment=True, download_name=name)


def _compare_name(filename: str) -> str:
    stem = Path(filename).stem or "结果"
    stem = re.sub(r"[\\/:*?\"<>|]+", "_", stem).strip()[:80] or "结果"
    return f"{stem}_对比.xlsx"


@app.get("/api/result/<upload_id>")
def result_file(upload_id: str):
    stored = UPLOADS.get(upload_id)
    if stored is None:
        return jsonify({"error": "请重新上传文件"}), 400
    original = stored[2] if len(stored) > 2 else "结果.xlsx"
    path = _result_path(stored[1], original)
    if not path.is_file():
        return jsonify({"error": "还没有可下载的计算结果"}), 404
    name = _result_name(original)
    return send_file(path, as_attachment=True, download_name=name)


if __name__ == "__main__":
    loaded = ensure_library()
    port = int(os.environ.get("RWA_PORT", "8766"))
    print(f"已读取规则库 {len(loaded)} 条")
    print(f"市场风险 RWA 服务: http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=False)
