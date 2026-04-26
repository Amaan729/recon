"""
Centralised LLM routing for Recon.
Every AI call in the codebase should go through one of these factory
functions instead of instantiating models directly.
"""

import itertools
import logging
import os

logger = logging.getLogger(__name__)

_TAILORING_KEY_INDEX = itertools.count()


def _clean_env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _get_mistral_llm(temperature: float = 0.2):
    api_key = _clean_env("MISTRAL_API_KEY")
    if not api_key:
        raise RuntimeError("MISTRAL_API_KEY is not set")

    try:
        from langchain_mistralai import ChatMistralAI
    except ImportError as exc:
        raise RuntimeError("langchain-mistralai is not installed") from exc

    return ChatMistralAI(
        model="mistral-small-latest",
        api_key=api_key,
        temperature=temperature,
    )


def get_browser_nav_llm():
    """Primary: Gemini 2.5 Flash-Lite. Fallback: Gemini 2.5 Flash."""
    primary_api_key = _clean_env("GOOGLE_AI_API_KEY")
    fallback_api_key = primary_api_key or _clean_env("GOOGLE_AI_API_KEY_2")

    if primary_api_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash-lite-preview-06-17",
                google_api_key=primary_api_key,
                temperature=0.1,
            )
        except ImportError:
            logger.warning(
                "Browser nav fallback: langchain-google-genai unavailable for Flash-Lite"
            )
        except Exception as exc:
            logger.warning("Browser nav fallback from Flash-Lite: %s", exc)
    else:
        logger.warning(
            "Browser nav fallback: GOOGLE_AI_API_KEY missing for Flash-Lite"
        )

    if fallback_api_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                google_api_key=fallback_api_key,
                temperature=0.1,
            )
        except ImportError:
            logger.warning(
                "Browser nav fallback exhausted: langchain-google-genai unavailable for Flash"
            )
        except Exception as exc:
            logger.warning("Browser nav fallback from Flash: %s", exc)

    raise RuntimeError(
        "No LLM available for browser navigation: set GOOGLE_AI_API_KEY or GOOGLE_AI_API_KEY_2"
    )


def get_tailoring_llm():
    """Primary: Gemini 2.5 Flash with key round-robin. Fallback: Mistral."""
    keys = [
        key for key in (
            _clean_env("GOOGLE_AI_API_KEY"),
            _clean_env("GOOGLE_AI_API_KEY_2"),
        )
        if key
    ]

    if keys:
        selected_key = keys[next(_TAILORING_KEY_INDEX) % len(keys)]
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                google_api_key=selected_key,
                temperature=0.2,
            )
        except ImportError:
            logger.warning(
                "Tailoring fallback: langchain-google-genai unavailable, trying Mistral"
            )
        except Exception as exc:
            logger.warning("Tailoring fallback from Gemini: %s", exc)
    else:
        logger.warning(
            "Tailoring fallback: no Gemini keys set, trying Mistral"
        )

    try:
        return _get_mistral_llm(temperature=0.2)
    except Exception as exc:
        logger.warning("Tailoring fallback from Mistral failed: %s", exc)

    raise RuntimeError(
        "No LLM available for tailoring: set GOOGLE_AI_API_KEY or MISTRAL_API_KEY"
    )


def get_cover_letter_llm():
    """Primary: Cerebras Llama 3.3 70B. Fallback: Cohere Command R+, then Mistral."""
    cerebras_api_key = _clean_env("CEREBRAS_API_KEY")
    if cerebras_api_key:
        try:
            from langchain_cerebras import ChatCerebras

            return ChatCerebras(
                model="llama3.3-70b",
                api_key=cerebras_api_key,
                temperature=0.2,
            )
        except ImportError:
            logger.warning(
                "Cover letter fallback: langchain-cerebras unavailable, trying Cohere"
            )
        except Exception as exc:
            logger.warning("Cover letter fallback from Cerebras: %s", exc)
    else:
        logger.warning(
            "Cover letter fallback: CEREBRAS_API_KEY missing, trying Cohere"
        )

    cohere_api_key = _clean_env("COHERE_API_KEY")
    if cohere_api_key:
        try:
            from langchain_cohere import ChatCohere

            return ChatCohere(
                model="command-r-plus",
                cohere_api_key=cohere_api_key,
                temperature=0.2,
            )
        except ImportError:
            logger.warning(
                "Cover letter fallback: langchain-cohere unavailable, trying Mistral"
            )
        except Exception as exc:
            logger.warning("Cover letter fallback from Cohere: %s", exc)
    else:
        logger.warning(
            "Cover letter fallback: COHERE_API_KEY missing, trying Mistral"
        )

    try:
        return _get_mistral_llm(temperature=0.2)
    except Exception as exc:
        logger.warning("Cover letter fallback from Mistral failed: %s", exc)

    raise RuntimeError(
        "No LLM available for cover letters: set CEREBRAS_API_KEY, COHERE_API_KEY, or MISTRAL_API_KEY"
    )


def get_email_llm():
    """Primary: Cerebras Llama 3.3 70B. Fallback: Cohere Command R+, then Mistral."""
    cerebras_api_key = _clean_env("CEREBRAS_API_KEY")
    if cerebras_api_key:
        try:
            from langchain_cerebras import ChatCerebras

            return ChatCerebras(
                model="llama3.3-70b",
                api_key=cerebras_api_key,
                temperature=0.2,
            )
        except ImportError:
            logger.warning(
                "Email fallback: langchain-cerebras unavailable, trying Cohere"
            )
        except Exception as exc:
            logger.warning("Email fallback from Cerebras: %s", exc)
    else:
        logger.warning("Email fallback: CEREBRAS_API_KEY missing, trying Cohere")

    cohere_api_key = _clean_env("COHERE_API_KEY")
    if cohere_api_key:
        try:
            from langchain_cohere import ChatCohere

            return ChatCohere(
                model="command-r-plus",
                cohere_api_key=cohere_api_key,
                temperature=0.2,
            )
        except ImportError:
            logger.warning(
                "Email fallback: langchain-cohere unavailable, trying Mistral"
            )
        except Exception as exc:
            logger.warning("Email fallback from Cohere: %s", exc)
    else:
        logger.warning("Email fallback: COHERE_API_KEY missing, trying Mistral")

    try:
        return _get_mistral_llm(temperature=0.2)
    except Exception as exc:
        logger.warning("Email fallback from Mistral failed: %s", exc)

    raise RuntimeError(
        "No LLM available for email generation: set CEREBRAS_API_KEY, COHERE_API_KEY, or MISTRAL_API_KEY"
    )


def get_json_extraction_llm():
    """Primary: Groq Llama 3.3 70B. Fallback: Gemini 2.5 Flash-Lite."""
    groq_api_key = _clean_env("GROQ_API_KEY")
    if groq_api_key:
        try:
            from langchain_groq import ChatGroq

            return ChatGroq(
                model="llama-3.3-70b-versatile",
                api_key=groq_api_key,
                temperature=0.1,
            )
        except ImportError:
            logger.warning(
                "JSON extraction fallback: langchain-groq unavailable, trying Gemini Flash-Lite"
            )
        except Exception as exc:
            logger.warning("JSON extraction fallback from Groq: %s", exc)
    else:
        logger.warning(
            "JSON extraction fallback: GROQ_API_KEY missing, trying Gemini Flash-Lite"
        )

    google_api_key = _clean_env("GOOGLE_AI_API_KEY") or _clean_env("GOOGLE_AI_API_KEY_2")
    if google_api_key:
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI

            return ChatGoogleGenerativeAI(
                model="gemini-2.5-flash-lite-preview-06-17",
                google_api_key=google_api_key,
                temperature=0.1,
            )
        except ImportError:
            logger.warning(
                "JSON extraction fallback exhausted: langchain-google-genai unavailable"
            )
        except Exception as exc:
            logger.warning("JSON extraction fallback from Gemini Flash-Lite: %s", exc)

    raise RuntimeError(
        "No LLM available for JSON extraction: set GROQ_API_KEY or GOOGLE_AI_API_KEY"
    )


def get_agent_fallback_llm():
    """Primary: DeepSeek V3 via OpenRouter. Fallback: Mistral."""
    openrouter_api_key = _clean_env("OPENROUTER_API_KEY")
    if openrouter_api_key:
        try:
            from langchain_openai import ChatOpenAI

            return ChatOpenAI(
                model="deepseek/deepseek-chat",
                api_key=openrouter_api_key,
                base_url="https://openrouter.ai/api/v1",
                temperature=0.1,
            )
        except ImportError:
            logger.warning(
                "Agent fallback: langchain-openai unavailable, trying Mistral"
            )
        except Exception as exc:
            logger.warning("Agent fallback from OpenRouter DeepSeek: %s", exc)
    else:
        logger.warning(
            "Agent fallback: OPENROUTER_API_KEY missing, trying Mistral"
        )

    try:
        return _get_mistral_llm(temperature=0.1)
    except Exception as exc:
        logger.warning("Agent fallback from Mistral failed: %s", exc)

    raise RuntimeError(
        "No LLM available for stuck agent fallback: set OPENROUTER_API_KEY or MISTRAL_API_KEY"
    )
