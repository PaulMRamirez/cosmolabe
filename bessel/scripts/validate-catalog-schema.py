#!/usr/bin/env python3
"""Validate the Bessel catalog schema and its reference example.

Runs the four gates recorded in docs/catalog-schema.md and ADR-0006:
  1. The schema validates against the JSON Schema 2020-12 meta-schema.
  2. The Cassini-style reference instance validates clean.
  3. Negative A: a spacecraft with both arcs and trajectory is rejected.
  4. Negative B: sideDivisions 1 (the Cosmographia crash case) is rejected.

Usage: python3 scripts/validate-catalog-schema.py
Requires: pip install jsonschema (4.x)

These same gates become Vitest catalog tests in Phase 1; this script exists so
the claim "validated" is reproducible before any code exists, and as a quick
check after hand edits to the schema or example.
"""
import copy
import json
import pathlib
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("FAIL: jsonschema not installed. Run: pip install jsonschema")
    sys.exit(2)

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "packages/catalog/schema/bessel-catalog.schema.json"
EXAMPLE = ROOT / "packages/catalog/schema/examples/cassini-saturn.example.json"

ok = True

schema = json.loads(SCHEMA.read_text())
instance = json.loads(EXAMPLE.read_text())

try:
    Draft202012Validator.check_schema(schema)
    print("PASS: schema is a valid Draft 2020-12 JSON Schema")
except Exception as exc:
    ok = False
    print("FAIL: schema meta-validation:", exc)

print(f"INFO: $defs count = {len(schema['$defs'])}")

validator = Draft202012Validator(schema)

errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.absolute_path))
if errors:
    ok = False
    print(f"FAIL: reference instance produced {len(errors)} error(s):")
    for err in errors[:10]:
        print("   ", list(err.absolute_path), "->", err.message)
else:
    print("PASS: Cassini-style reference instance validates clean")

negative_a = copy.deepcopy(instance)
negative_a["spacecraft"][0]["trajectory"] = {"type": "Spice"}
if list(validator.iter_errors(negative_a)):
    print("PASS: negative A (arcs plus trajectory) rejected")
else:
    ok = False
    print("FAIL: negative A should have been rejected")

negative_b = copy.deepcopy(instance)
negative_b["instruments"][0]["fov"]["styles"]["default"]["sideDivisions"] = 1
hits = [
    e for e in validator.iter_errors(negative_b)
    if "sideDivisions" in str(list(e.absolute_path))
]
if hits:
    print("PASS: negative B (sideDivisions 1) rejected")
else:
    ok = False
    print("FAIL: negative B should have been rejected on sideDivisions")

print("RESULT:", "ALL GATES PASS" if ok else "FAILURES PRESENT")
sys.exit(0 if ok else 1)
