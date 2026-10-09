"""The only way Klartext talks to a language model (CLAUDE.md rule 2).

OpenAI-compatible endpoint from LLM_BASE_URL: OpenRouter during the sprint, a self-hosted vLLM
server in production. Open-weight models only.

complete_json() asks for JSON matching a Pydantic model:
  1. structured output (json_schema) where the endpoint supports it, else JSON mode
  2. Pydantic validation; on failure one retry with the validation error appended
  3. rate limits, timeouts and 5xx: exponential backoff, max 3 tries
It never raises for model or network problems: callers get LLMResult(ok=False) and fail safe.
Logs model, latency and token counts only. Never prompts, transcripts or keys.
"""

from __future__ import annotations

import json
import logging
import re
import time
from functools import lru_cache
from typing import Generic, TypeVar

import openai
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from app.config import get_settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

MAX_TRANSPORT_TRIES = 3
BACKOFF_BASE_S = 2.0
REQUEST_TIMEOUT_S = 120.0
RETRYABLE = (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError)
THINK_RE = re.compile(r"<think>.*?</think>", re.S)
FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$")

# Models whose endpoint rejected json_schema: use JSON mode for them from then on.
_json_mode_only: set[str] = set()


class LLMResult(BaseModel, Generic[T]):
    ok: bool
    value: T | None = None
    error: str | None = None
    model: str
    latency_ms: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    calls: int = 0


class _TransportError(Exception):
    pass


@lru_cache
def _client() -> OpenAI:
    s = get_settings()
    # SDK retries off: backoff is handled here so every attempt is counted and logged.
    return OpenAI(base_url=s.llm_base_url, api_key=s.llm_api_key.get_secret_value(), max_retries=0, timeout=REQUEST_TIMEOUT_S)


def _response_format(schema_model: type[BaseModel], model: str) -> dict:
    if model in _json_mode_only:
        return {"type": "json_object"}
    return {
        "type": "json_schema",
        "json_schema": {"name": schema_model.__name__, "strict": True, "schema": schema_model.model_json_schema()},
    }


def _extract_json(text: str) -> str:
    text = THINK_RE.sub("", text or "").strip()
    text = FENCE_RE.sub("", text).strip()
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end > start else text


def _short_error(exc: openai.APIStatusError) -> str:
    """Provider message only: response bodies can carry account identifiers that must not reach logs."""
    body = exc.body if isinstance(exc.body, dict) else {}
    err = body.get("error", body)
    msg = err.get("message") if isinstance(err, dict) else None
    return f"HTTP {exc.status_code}: {msg or type(exc).__name__}"


def _call(messages: list[dict], schema_model: type[BaseModel], model: str, temperature: float):
    """One chat completion with transport backoff. Falls back to JSON mode if json_schema is rejected."""
    for attempt in range(1, MAX_TRANSPORT_TRIES + 1):
        try:
            return _client().chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                response_format=_response_format(schema_model, model),
            )
        except openai.BadRequestError as exc:
            msg = str(exc).lower()
            if model not in _json_mode_only and ("response_format" in msg or "json_schema" in msg):
                log.warning("Model %s rejected json_schema, switching to JSON mode", model)
                _json_mode_only.add(model)
                continue
            raise _TransportError(_short_error(exc)) from exc
        except RETRYABLE as exc:
            if attempt == MAX_TRANSPORT_TRIES:
                raise _TransportError(f"{type(exc).__name__} after {attempt} tries") from exc
            wait = BACKOFF_BASE_S * 2 ** (attempt - 1)
            log.warning("LLM %s (%s), retry %d in %.0f s", type(exc).__name__, model, attempt, wait)
            time.sleep(wait)
        except openai.APIStatusError as exc:
            raise _TransportError(_short_error(exc)) from exc
    raise _TransportError("No response")


def complete_json(
    system: str,
    user: str,
    schema_model: type[T],
    temperature: float | None = None,
    model: str | None = None,
) -> LLMResult[T]:
    s = get_settings()
    model = model or s.llm_model
    temperature = s.llm_temperature if temperature is None else temperature
    schema_hint = (
        "\n\nRespond with one JSON object only, matching this JSON schema:\n"
        + json.dumps(schema_model.model_json_schema(), ensure_ascii=False)
    )
    messages: list[dict] = [{"role": "system", "content": system + schema_hint}, {"role": "user", "content": user}]
    result: LLMResult[T] = LLMResult(ok=False, model=model)
    started = time.monotonic()

    for validation_try in range(2):  # first answer + one retry with the validation error
        try:
            resp = _call(messages, schema_model, model, temperature)
        except _TransportError as exc:
            result.error = str(exc)
            break
        result.calls += 1
        if resp.usage:
            result.prompt_tokens += resp.usage.prompt_tokens or 0
            result.completion_tokens += resp.usage.completion_tokens or 0
        content = resp.choices[0].message.content if resp.choices else ""
        try:
            result.value = schema_model.model_validate_json(_extract_json(content or ""))
            result.ok = True
            result.error = None
            break
        except ValidationError as exc:
            result.error = f"Invalid JSON output: {exc.error_count()} error(s)"
            if validation_try == 0:
                messages += [
                    {"role": "assistant", "content": content or ""},
                    {"role": "user", "content": f"Your answer did not match the schema:\n{exc}\nReturn only the corrected JSON object."},
                ]

    result.latency_ms = int((time.monotonic() - started) * 1000)
    log.info(
        "LLM %s ok=%s calls=%d latency=%dms tokens=%d+%d%s",
        model, result.ok, result.calls, result.latency_ms, result.prompt_tokens, result.completion_tokens,
        "" if result.ok else f" error={result.error}",
    )
    return result


if __name__ == "__main__":
    # Smoke test (B9 check): python -m app.services.llm_client
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx2").setLevel(logging.WARNING)

    class ToyAnswer(BaseModel):
        city: str
        canton: str
        is_capital_of_switzerland: bool
        reason: str

    r = complete_json(
        system="You answer geography questions about Switzerland.",
        user="Which city is the seat of the Swiss federal government, and in which canton is it?",
        schema_model=ToyAnswer,
        temperature=0.0,
    )
    print(r.model_dump_json(indent=2))
