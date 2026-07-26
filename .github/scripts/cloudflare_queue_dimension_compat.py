"""Compatibility adapter for Cloudflare Queue Analytics dimension names."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import cloudflare_free_tier_audit as core

_QUEUE_DIMENSIONS = "dimensions { queueID actionType consumerType }"
_QUEUE_DIMENSION_VARIANTS = (
    "dimensions { queueID: queueId actionType consumerType }",
    "dimensions { actionType consumerType }",
    "dimensions { actionType }",
    "",
)


def compatible_documents(document: str) -> tuple[str, ...]:
    if _QUEUE_DIMENSIONS not in document:
        return (document,)
    return tuple(document.replace(_QUEUE_DIMENSIONS, variant) for variant in _QUEUE_DIMENSION_VARIANTS)


def compatible_api(original_api: Callable[[dict[str, Any]], dict[str, Any]]):
    def request(payload: dict[str, Any]) -> dict[str, Any]:
        query = str(payload.get("query") or "")
        documents = compatible_documents(query)
        last_error: RuntimeError | None = None
        for document in documents:
            attempt = {**payload, "query": document}
            try:
                return original_api(attempt)
            except RuntimeError as error:
                if "unknown field" not in str(error).lower() or len(documents) == 1:
                    raise
                last_error = error
        if last_error is not None:
            raise last_error
        return original_api(payload)

    return request


def self_test() -> int:
    result = core.self_test()
    variants = compatible_documents(core.graphql_document())
    assert "dimensions { queueID: queueId actionType consumerType }" in variants[0]
    assert "dimensions { actionType consumerType }" in variants[1]
    assert "dimensions { actionType }" in variants[2]
    assert _QUEUE_DIMENSIONS not in variants[3]

    calls: list[str] = []

    def simulated_api(payload: dict[str, Any]) -> dict[str, Any]:
        query = str(payload.get("query") or "")
        calls.append(query)
        if "queueID: queueId" in query:
            raise RuntimeError('Cloudflare API error: unknown field "queueId"')
        return {"success": True}

    response = compatible_api(simulated_api)({"query": core.graphql_document()})
    assert response == {"success": True}
    assert len(calls) == 2
    assert "dimensions { actionType consumerType }" in calls[1]
    print("Cloudflare Queue dimension compatibility self-test passed")
    return result


def main() -> int:
    original_api = core.api
    core.api = compatible_api(original_api)
    try:
        return core.main()
    finally:
        core.api = original_api
