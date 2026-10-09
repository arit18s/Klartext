"""App settings from `.env` (repo root). Relative paths resolve against the repo root."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore")

    # LLM
    llm_base_url: str = "https://openrouter.ai/api/v1"
    llm_api_key: SecretStr = SecretStr("")
    llm_model: str = ""
    llm_samples: int = 3
    llm_temperature: float = 0.3
    llm_reasoning: Literal["on", "off"] = "on"  # model "thinking"; switch without code changes
    llm_concurrency: int = 8  # parallel LLM requests

    # Speech
    asr_model: str = ""
    asr_service_url: str = ""
    hf_token: SecretStr = SecretStr("")

    # App
    data_dir: Path = Path("./data")
    inbox_dir: Path = Path("./inbox")
    case_data_dir: Path = Path("./case-data")
    public_base_url: str = "http://localhost:5173"
    trigger_api_url: str = "http://localhost:8080"
    trigger_api_enabled: bool = True
    retention_days: int = 30

    def path(self, p: Path) -> Path:
        return p if p.is_absolute() else (REPO_ROOT / p).resolve()

    @property
    def data_path(self) -> Path:
        return self.path(self.data_dir)

    @property
    def inbox_path(self) -> Path:
        return self.path(self.inbox_dir)

    @property
    def case_data_path(self) -> Path:
        return self.path(self.case_data_dir)

    @property
    def llm_cache_path(self) -> Path:
        return self.data_path / "llm_cache"

    @property
    def db_path(self) -> Path:
        return self.data_path / "klartext.db"


@lru_cache
def get_settings() -> Settings:
    return Settings()
