"""
Data Helper Functions
Text processing, formatting, and validation utilities
"""
import re
import unicodedata
from datetime import datetime
from typing import Any


class DataFormatter:
    """Data formatting utilities"""

    @staticmethod
    def clean_text(text: Any) -> str:
        """Clean and normalize text"""
        if not text:
            return str(text) if text is not None else ""

        text = unicodedata.normalize("NFKC", str(text))
        replacements = {
            "–": "-",
            "—": "-",
            "…": "...",
            """: '"',
            """: '"',
            "'": "'",
            "'": "'",
        }

        for old, new in replacements.items():
            text = text.replace(old, new)

        return text

    @staticmethod
    def format_cpf(cpf: str) -> str:
        """Format CPF with proper zero-padding as XXX.XXX.XXX-XX"""
        if not cpf:
            return ""

        # Remove all non-digit characters
        cpf_digits = re.sub(r'\D', '', cpf)

        # Ensure 11 digits with zero-padding
        cpf_digits = cpf_digits.zfill(11)

        # Validate length
        if len(cpf_digits) != 11:
            return cpf  # Return original if invalid

        # Format as XXX.XXX.XXX-XX
        return f"{cpf_digits[:3]}.{cpf_digits[3:6]}.{cpf_digits[6:9]}-{cpf_digits[9:]}"

    @staticmethod
    def format_currency(value: Any) -> str:
        """Format currency value"""
        if not value:
            return "Not informed"

        try:
            return f"R$ {float(value):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        except (ValueError, TypeError):
            return f"R$ {value}"

    @staticmethod
    def format_date(date_str: Any) -> str:
        """Format date string"""
        if not date_str:
            return "Not informed"

        try:
            date = datetime.fromisoformat(str(date_str).replace('Z', '+00:00'))
            return date.strftime('%d/%m/%Y')
        except (ValueError, TypeError):
            return str(date_str)


class CPFValidator:
    """CPF validation utilities"""

    @staticmethod
    def is_cpf(text: str) -> bool:
        """Check if text is a valid CPF format"""
        if not text:
            return False

        cpf = re.sub(r'\D', '', text)
        return len(cpf) == 11 and cpf != cpf[0] * 11

    @staticmethod
    def extract_cpfs_from_text(text: str) -> list:
        """Extract all CPFs from a text string"""
        if not text:
            return []

        # Pattern for CPF: XXX.XXX.XXX-XX or XXXXXXXXXXX
        cpf_pattern = r'\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b'
        matches = re.findall(cpf_pattern, str(text))

        # Clean and validate CPFs
        valid_cpfs = []
        for match in matches:
            cpf = re.sub(r'\D', '', match)
            if len(cpf) == 11 and cpf != cpf[0] * 11:  # Basic validation
                # Ensure CPF is stored with leading zeros (11 digits)
                valid_cpfs.append(cpf.zfill(11))

        return valid_cpfs
