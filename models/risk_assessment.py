"""
Risk Assessment Models
LLM integration and risk scoring logic
"""
import streamlit as st
import google.generativeai as genai
from typing import Dict, List, Optional


class RiskAssessmentLLM:
    """Handles Google Gemini LLM integration for risk assessment"""

    def __init__(self):
        self.api_key = st.secrets.get("GEMINI_API_KEY", "")
        self.model_name = st.secrets.get("GEMINI_MODEL", "gemini-1.5-flash")
        self._model = None
        self._available = None

    def is_available(self) -> bool:
        """Check if Gemini API is configured"""
        if self._available is not None:
            return self._available

        if not self.api_key or self.api_key == "your_gemini_api_key_here":
            self._available = False
            return False

        try:
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(self.model_name)
            self._available = True
            return True
        except Exception as e:
            st.warning(f"Gemini configuration error: {e}")
            self._available = False
            return False

    def analyze_processes(self, processes: List[Dict], person_info: Dict) -> Dict:
        """Analyze processes using Gemini LLM"""
        if not self.is_available():
            return {
                "llm_available": False,
                "insights": "LLM analysis unavailable. Please configure GEMINI_API_KEY in secrets.toml. Get your free API key at: https://aistudio.google.com/app/apikey",
                "red_flags": [],
                "recommendation": "manual_review"
            }

        # Prepare context for LLM
        process_summary = self._prepare_process_summary(processes)
        prompt = self._build_analysis_prompt(process_summary, person_info)

        try:
            # Call Gemini API
            response = self._model.generate_content(
                prompt,
                generation_config={
                    "temperature": 0.3,
                    "top_p": 0.95,
                    "top_k": 40,
                    "max_output_tokens": 1024,
                }
            )

            if response and response.text:
                return self._parse_llm_response(response.text)
            else:
                return self._get_fallback_analysis()

        except Exception as e:
            st.warning(f"Gemini API error: {e}")
            return self._get_fallback_analysis()

    def _prepare_process_summary(self, processes: List[Dict]) -> str:
        """Prepare concise process summary for LLM"""
        if not processes:
            return "No judicial processes found."

        summary_parts = [f"Total processes: {len(processes)}"]

        # Count by type and role
        case_types = {}
        roles = {"defendant": 0, "plaintiff": 0, "other": 0}
        total_value = 0

        for proc in processes:
            # Case class
            proc_class = proc.get("classeProcessual", {}).get("nome", "Unknown")
            case_types[proc_class] = case_types.get(proc_class, 0) + 1

            # Role detection
            for party in proc.get("partes", []):
                party_type = party.get("tipo", "").lower()
                if "reu" in party_type or "executado" in party_type:
                    roles["defendant"] += 1
                elif "autor" in party_type or "exequente" in party_type:
                    roles["plaintiff"] += 1
                else:
                    roles["other"] += 1

            # Case value
            value = proc.get("valorCausa", {}).get("valor", 0)
            if value:
                try:
                    total_value += float(value)
                except (ValueError, TypeError):
                    pass

        summary_parts.append(f"Defendant in {roles['defendant']} cases, Plaintiff in {roles['plaintiff']} cases")
        summary_parts.append(f"Total financial exposure: R$ {total_value:,.2f}")
        summary_parts.append(f"Case types: {', '.join([f'{k} ({v})' for k, v in list(case_types.items())[:5]])}")

        return " | ".join(summary_parts)

    def _build_analysis_prompt(self, process_summary: str, person_info: Dict) -> str:
        """Build prompt for LLM analysis"""
        return f"""You are a Know-Your-Employee (KYE) risk analyst for HR departments in Brazil. Analyze the following judicial process information and provide a brief risk assessment.

PERSON INFORMATION:
- Name/CPF: {person_info.get('search_term', 'N/A')}

JUDICIAL PROCESSES SUMMARY:
{process_summary}

Provide a concise analysis in the following format:

RISK LEVEL: [Low/Medium/High/Critical]

KEY INSIGHTS:
- [2-3 bullet points about the main findings]

RED FLAGS:
- [List specific concerns, or write "None identified" if clean]

RECOMMENDATION:
- [One sentence recommendation: approve, review with caution, or reject]

Keep your response under 200 words and focus on employment risk factors."""

    def _parse_llm_response(self, response: str) -> Dict:
        """Parse LLM response into structured data"""
        lines = response.strip().split("\n")

        result = {
            "llm_available": True,
            "insights": "",
            "red_flags": [],
            "recommendation": "review",
            "raw_response": response
        }

        current_section = None
        insights_lines = []
        red_flags = []

        for line in lines:
            line = line.strip()
            if not line:
                continue

            if "KEY INSIGHTS:" in line or "INSIGHTS:" in line:
                current_section = "insights"
            elif "RED FLAGS:" in line or "RED FLAG:" in line:
                current_section = "red_flags"
            elif "RECOMMENDATION:" in line:
                current_section = "recommendation"
            elif current_section == "insights" and line.startswith("-"):
                insights_lines.append(line[1:].strip())
            elif current_section == "red_flags" and line.startswith("-"):
                flag = line[1:].strip()
                if flag.lower() != "none identified" and flag.lower() != "none":
                    red_flags.append(flag)
            elif current_section == "recommendation":
                result["recommendation"] = line

        result["insights"] = "\n".join(insights_lines) if insights_lines else response
        result["red_flags"] = red_flags

        return result

    def _get_fallback_analysis(self) -> Dict:
        """Fallback analysis when LLM is unavailable"""
        return {
            "llm_available": False,
            "insights": "Automated analysis unavailable. Manual review recommended.",
            "red_flags": [],
            "recommendation": "manual_review"
        }


class RiskAssessor:
    """Calculate risk scores based on judicial process data"""

    # Risk weights for different factors
    WEIGHTS = {
        "process_count": 0.25,
        "defendant_role": 0.30,
        "case_severity": 0.25,
        "financial_exposure": 0.20
    }

    # Case type severity (higher = more severe)
    CASE_SEVERITY = {
        "criminal": 100,
        "penal": 100,
        "trabalhista": 70,
        "labor": 70,
        "trabalho": 70,
        "execu": 60,  # Execução
        "civil": 40,
        "família": 30,
        "family": 30,
        "consumidor": 25,
    }

    def __init__(self, llm: Optional[RiskAssessmentLLM] = None):
        self.llm = llm or RiskAssessmentLLM()

    def assess_risk(self, processes: List[Dict], person_info: Dict) -> Dict:
        """
        Perform complete risk assessment
        Returns: {
            "score": 0-100,
            "level": "low/medium/high/critical",
            "factors": {...},
            "llm_analysis": {...}
        }
        """
        if not processes or len(processes) == 0:
            return {
                "score": 0,
                "level": "low",
                "level_label": "Low Risk",
                "color": "green",
                "emoji": "✅",
                "factors": {
                    "process_count_score": 0,
                    "defendant_score": 0,
                    "severity_score": 0,
                    "financial_score": 0
                },
                "llm_analysis": {
                    "llm_available": True,
                    "insights": "No judicial processes found. Clean background check.",
                    "red_flags": [],
                    "recommendation": "Approved for employment - clean record"
                },
                "summary": "Clean record with no judicial processes"
            }

        # Calculate individual factor scores
        factors = {
            "process_count_score": self._calculate_process_count_score(processes),
            "defendant_score": self._calculate_defendant_score(processes),
            "severity_score": self._calculate_severity_score(processes),
            "financial_score": self._calculate_financial_score(processes)
        }

        # Weighted total score
        total_score = sum(
            factors[f"{key}_score"] * weight
            for key, weight in self.WEIGHTS.items()
        )

        # Get LLM analysis
        llm_analysis = self.llm.analyze_processes(processes, person_info)

        # Determine risk level
        level_info = self._get_risk_level(total_score)

        return {
            "score": round(total_score, 1),
            "level": level_info["level"],
            "level_label": level_info["label"],
            "color": level_info["color"],
            "emoji": level_info["emoji"],
            "factors": factors,
            "llm_analysis": llm_analysis,
            "summary": self._generate_summary(total_score, len(processes))
        }

    def _calculate_process_count_score(self, processes: List[Dict]) -> float:
        """Score based on number of processes (0-100)"""
        count = len(processes)
        if count == 0:
            return 0
        elif count == 1:
            return 20
        elif count == 2:
            return 35
        elif count <= 5:
            return 50
        elif count <= 10:
            return 70
        else:
            return min(100, 70 + (count - 10) * 3)

    def _calculate_defendant_score(self, processes: List[Dict]) -> float:
        """Score based on defendant role (0-100)"""
        defendant_count = 0
        total_roles = 0

        for proc in processes:
            for party in proc.get("partes", []):
                party_type = party.get("tipo", "").lower()
                total_roles += 1
                if any(keyword in party_type for keyword in ["réu", "reu", "executado", "demandado"]):
                    defendant_count += 1

        if total_roles == 0:
            return 30  # Unknown = moderate risk

        defendant_ratio = defendant_count / total_roles
        return defendant_ratio * 100

    def _calculate_severity_score(self, processes: List[Dict]) -> float:
        """Score based on case type severity (0-100)"""
        if not processes:
            return 0

        severity_scores = []

        for proc in processes:
            proc_class = proc.get("classeProcessual", {}).get("nome", "").lower()

            # Check against severity keywords
            max_severity = 30  # Default for unknown types
            for keyword, severity in self.CASE_SEVERITY.items():
                if keyword in proc_class:
                    max_severity = max(max_severity, severity)

            severity_scores.append(max_severity)

        # Average severity with weight on max
        if severity_scores:
            avg_severity = sum(severity_scores) / len(severity_scores)
            max_severity = max(severity_scores)
            return (avg_severity * 0.6 + max_severity * 0.4)

        return 30

    def _calculate_financial_score(self, processes: List[Dict]) -> float:
        """Score based on financial exposure (0-100)"""
        total_value = 0

        for proc in processes:
            value = proc.get("valorCausa", {}).get("valor", 0)
            if value:
                try:
                    total_value += float(value)
                except (ValueError, TypeError):
                    pass

        # Score based on total value thresholds (Brazilian Reais)
        if total_value == 0:
            return 10
        elif total_value < 10000:
            return 20
        elif total_value < 50000:
            return 35
        elif total_value < 100000:
            return 50
        elif total_value < 500000:
            return 70
        else:
            return min(100, 70 + (total_value - 500000) / 100000)

    def _get_risk_level(self, score: float) -> Dict:
        """Convert score to risk level"""
        if score < 25:
            return {"level": "low", "label": "Low Risk", "color": "green", "emoji": "✅"}
        elif score < 50:
            return {"level": "medium", "label": "Medium Risk", "color": "orange", "emoji": "⚠️"}
        elif score < 75:
            return {"level": "high", "label": "High Risk", "color": "red", "emoji": "🔴"}
        else:
            return {"level": "critical", "label": "Critical Risk", "color": "darkred", "emoji": "⛔"}

    def _generate_summary(self, score: float, process_count: int) -> str:
        """Generate human-readable summary"""
        if score < 25:
            return f"{process_count} process(es) found with minimal risk factors"
        elif score < 50:
            return f"{process_count} process(es) with some concerns - review recommended"
        elif score < 75:
            return f"{process_count} process(es) with significant risk - careful review needed"
        else:
            return f"{process_count} process(es) with major risk factors - high caution advised"
