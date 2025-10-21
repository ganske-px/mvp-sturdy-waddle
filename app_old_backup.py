import streamlit as st
import requests
import re
import json
import os
import hashlib
import unicodedata
import pandas as pd
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from posthog import Posthog, new_context, identify_context
import google.generativeai as genai

# Configuration
HIST_PATH = Path(os.getenv("STREAMLIT_HOME", ".")) / "data"
HIST_PATH.mkdir(parents=True, exist_ok=True)
HIST_FILE = HIST_PATH / "historico_pesquisas.json"

# Constants
MAX_HISTORY_ITEMS = 50
REQUEST_TIMEOUT = 30

class PosthogAPI:
    """Handles Posthog analytics integration"""
    
    def __init__(self):
        self.user_id = None
        self._client = None

    def _get_client(self) -> Optional[Posthog]:
        """Get or create Posthog client"""
        if self._client is None:
            try:
                posthog_key = st.secrets.get("POSTHOG_KEY")
                posthog_host = st.secrets.get("POSTHOG_HOST")
                
                if posthog_key and posthog_host:
                    self._client = Posthog(posthog_key, host=posthog_host)
                else:
                    st.warning("Posthog credentials not configured properly")
            except Exception as e:
                st.error(f"Error initializing Posthog: {e}")
        
        return self._client

    def set_user(self, user: str, traits: Optional[Dict] = None) -> None:
        """Set current user and register login event"""
        self.user_id = user
        client = self._get_client()
        
        if not client:
            return
            
        try:
            with new_context():
                identify_context(user)
                client.capture("user_logged_in", properties=traits or {})
        except Exception as e:
            st.error(f"Error tracking user login: {e}")

    def track_search(self, search_key: str, is_new: bool = False) -> None:
        """Track search events"""
        client = self._get_client()
        
        if not client:
            return
            
        try:
            with new_context():
                identify_context(self.user_id)
                client.capture(
                    "user_request_search",
                    properties={"key": search_key, "isNewSearch": is_new}
                )
        except Exception as e:
            st.error(f"Error tracking search: {e}")


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
            "summary": self._generate_summary(total_score, len(processes), factors)
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

    def _generate_summary(self, score: float, process_count: int, factors: Dict) -> str:
        """Generate human-readable summary"""
        if score < 25:
            return f"{process_count} process(es) found with minimal risk factors"
        elif score < 50:
            return f"{process_count} process(es) with some concerns - review recommended"
        elif score < 75:
            return f"{process_count} process(es) with significant risk - careful review needed"
        else:
            return f"{process_count} process(es) with major risk factors - high caution advised"


class PredictusAPI:
    """Handles API communication with Predictus service"""

    def __init__(self):
        self.base_url = "https://api.predictus.inf.br"
        self.token = None

        self.username = st.secrets.get("PREDICTUS_USERNAME", "motoristapx.teste")
        self.password = st.secrets.get("PREDICTUS_PASSWORD", "")

        self._ua = {"User-Agent": "streamlit-app/1.0"}

    def authenticate(self) -> bool:
        """Authenticate with the API"""
        try:
            auth_url = f"{self.base_url}/auth"
            payload = {"username": self.username, "password": self.password}
            headers = {"Content-Type": "application/json", **self._ua}

            response = requests.post(
                auth_url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT
            )

            if response.status_code == 200:
                data = response.json() or {}
                self.token = data.get("accessToken")
                if not self.token:
                    st.error("Authentication succeeded but no accessToken in response.")
                    return False
                return True

            # Log helpful context for debugging
            try:
                err = response.json()
            except ValueError:
                err = response.text
            st.error(f"Authentication failed: {response.status_code} - {err}")
            return False

        except requests.exceptions.RequestException as e:
            st.error(f"Network error during authentication: {e}")
            return False
        except Exception as e:
            st.error(f"Unexpected error during authentication: {e}")
            return False

    def _make_request(self, endpoint: str, payload: Dict) -> Optional[Dict]:
        """Make authenticated API request"""
        if not self.token and not self.authenticate():
            return None

        url = f"{self.base_url}{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}",
            **self._ua,
        }

        try:
            response = requests.post(
                url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT
            )

            # Handle token expiration
            if response.status_code == 401:
                if self.authenticate():
                    headers["Authorization"] = f"Bearer {self.token}"
                    response = requests.post(
                        url, json=payload, headers=headers, timeout=REQUEST_TIMEOUT
                    )
                else:
                    return None

            # Success with data
            if response.status_code == 200:
                try:
                    data = response.json()
                    # Handle empty response body (some APIs return 200 with no content for clean CPFs)
                    return data if data else []
                except ValueError:
                    # 200 but no JSON body = clean CPF
                    return []

            # 204 No Content = CPF is clean (nada consta)
            if response.status_code == 204:
                return []

            # Surface verbose error body for other status codes
            try:
                err_body = response.json()
            except ValueError:
                err_body = response.text
            st.error(f"API request failed: {response.status_code} - {err_body}")
            return None

        except requests.exceptions.RequestException as e:
            st.error(f"Network error: {e}")
            return None
        except Exception as e:
            st.error(f"Unexpected error: {e}")
            return None

    def search_by_name(self, name: str) -> Optional[List[Dict]]:
        """Search processes by person name"""
        return self._make_request("/predictus-api/processos/judiciais/buscarPorNomeParte", {"nome": name.upper()})

    def search_by_cpf(self, cpf: str) -> Optional[List[Dict]]:
        """Search processes by CPF"""
        return self._make_request("/predictus-api/processos/judiciais/buscarPorCPFParte", {"cpf": cpf})

    def search_by_process_number(self, process_number: str) -> Optional[List[Dict]]:
        """Search process by CNJ number"""
        return self._make_request("/predictus-api/processos/judiciais/buscarPorNumeroCNJ", {"numeroProcessoUnico": process_number})

class AuthenticationManager:
    """Handles user authentication"""
    
    @staticmethod
    def hash_password(password: str) -> str:
        """Create SHA256 hash of password"""
        return hashlib.sha256(password.encode()).hexdigest()

    @staticmethod
    def verify_credentials(username: str, password: str) -> bool:
        """Verify if credentials are valid"""
        try:
            valid_users = st.secrets.get("USUARIOS_APP", {})
            return username in valid_users and valid_users[username] == password
        except Exception as e:
            st.error(f"Error verifying credentials: {e}")
            return False

    @staticmethod
    def is_authenticated() -> bool:
        """Check if user is authenticated"""
        return st.session_state.get('authenticated', False)

    @staticmethod
    def logout() -> None:
        """Logout user"""
        keys_to_clear = ['authenticated', 'username', 'login_time', 'api', 'resultados']
        for key in keys_to_clear:
            st.session_state.pop(key, None)
        
        st.success("✅ Logout successful!")
        st.rerun()


class DataManager:
    """Handles data persistence and management"""
    
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
            "“": '"',
            "”": '"',
            "‘": "'",
            "’": "'",
        }
        
        for old, new in replacements.items():
            text = text.replace(old, new)
            
        return text

    @staticmethod
    def is_cpf(text: str) -> bool:
        """Check if text is a valid CPF format"""
        if not text:
            return False

        cpf = re.sub(r'\D', '', text)
        return len(cpf) == 11 and cpf != cpf[0] * 11

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

    @staticmethod
    def load_search_history() -> List[Dict]:
        """Load search history from file"""
        try:
            if HIST_FILE.exists():
                with open(HIST_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
        except Exception as e:
            st.error(f"Error loading history: {e}")
        
        return []

    @staticmethod
    def save_search_history(history: List[Dict]) -> bool:
        """Save search history to file"""
        try:
            with open(HIST_FILE, 'w', encoding='utf-8') as f:
                json.dump(history, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            st.error(f"Error saving history: {e}")
            return False

    @staticmethod
    def save_process_details(process_number: str, details: Dict) -> bool:
        """Save process details to history"""
        try:
            history = st.session_state.get('historico_pesquisas', []).copy()
            
            for search in history:
                for process in search.get('resultados', []):
                    if process.get('numeroProcessoUnico') == process_number:
                        if 'detalhes_processos' not in search:
                            search['detalhes_processos'] = {}
                        search['detalhes_processos'][process_number] = details
                        
                        if DataManager.save_search_history(history):
                            st.session_state.historico_pesquisas = history
                            return True
                        return False
            return False
            
        except Exception as e:
            st.error(f"Error saving process details: {e}")
            return False


class CSVProcessor:
    """Handles CSV file processing and CPF extraction"""

    @staticmethod
    def extract_cpfs_from_text(text: str) -> List[str]:
        """Extract all CPFs from a text string"""
        if not text or pd.isna(text):
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

    @staticmethod
    def process_csv_file(uploaded_file) -> Tuple[List[str], pd.DataFrame]:
        """Process uploaded CSV and extract unique CPFs"""
        try:
            # Read CSV with various encodings
            try:
                df = pd.read_csv(uploaded_file, encoding='utf-8')
            except UnicodeDecodeError:
                uploaded_file.seek(0)
                df = pd.read_csv(uploaded_file, encoding='latin-1')

            # Extract CPFs from all columns
            all_cpfs = set()

            for column in df.columns:
                for value in df[column]:
                    cpfs = CSVProcessor.extract_cpfs_from_text(str(value))
                    all_cpfs.update(cpfs)

            unique_cpfs = sorted(list(all_cpfs))
            return unique_cpfs, df

        except Exception as e:
            st.error(f"Error processing CSV: {e}")
            return [], pd.DataFrame()

    @staticmethod
    def validate_csv_file(uploaded_file) -> Tuple[bool, str]:
        """Validate uploaded file"""
        if uploaded_file is None:
            return False, "No file uploaded"

        # Check file extension
        if not uploaded_file.name.endswith('.csv'):
            return False, "File must be a CSV file"

        # Check file size (max 10MB)
        file_size = uploaded_file.size
        if file_size > 10 * 1024 * 1024:
            return False, "File size exceeds 10MB limit"

        return True, "File is valid"


class BulkSearchManager:
    """Handles bulk CPF searches and result aggregation"""

    def __init__(self, api: PredictusAPI, posthog: PosthogAPI):
        self.api = api
        self.posthog = posthog
        self.risk_assessor = RiskAssessor()
        self.results = {
            'nada_consta': [],
            'found_processes': {},
            'errors': [],
            'risk_assessments': {}  # CPF -> risk_data
        }

    def search_cpf_list(self, cpf_list: List[str], progress_callback=None) -> Dict:
        """Search multiple CPFs and categorize results"""
        total = len(cpf_list)

        for idx, cpf in enumerate(cpf_list):
            # Update progress
            if progress_callback:
                progress_callback(idx + 1, total, cpf)

            try:
                # Search by CPF
                results = self.api.search_by_cpf(cpf)

                if results is None:
                    self.results['errors'].append({
                        'cpf': cpf,
                        'error': 'API request failed'
                    })
                elif len(results) == 0:
                    # Nada consta - still calculate risk (will be low/clean)
                    self.results['nada_consta'].append(cpf)
                    risk_data = self.risk_assessor.assess_risk([], {"search_term": cpf})
                    self.results['risk_assessments'][cpf] = risk_data
                else:
                    # Found processes - calculate risk
                    self.results['found_processes'][cpf] = results
                    risk_data = self.risk_assessor.assess_risk(results, {"search_term": cpf})
                    self.results['risk_assessments'][cpf] = risk_data

                # Track search in analytics
                self.posthog.track_search(cpf, is_new=True)

            except Exception as e:
                self.results['errors'].append({
                    'cpf': cpf,
                    'error': str(e)
                })

        return self.results

    def get_summary(self) -> Dict[str, int]:
        """Get summary statistics of bulk search"""
        # Risk level counts
        risk_counts = {'low': 0, 'medium': 0, 'high': 0, 'critical': 0}
        for risk_data in self.results['risk_assessments'].values():
            level = risk_data.get('level', 'low')
            risk_counts[level] = risk_counts.get(level, 0) + 1

        return {
            'total_searched': len(self.results['nada_consta']) + len(self.results['found_processes']) + len(self.results['errors']),
            'nada_consta': len(self.results['nada_consta']),
            'with_processes': len(self.results['found_processes']),
            'total_processes': sum(len(procs) for procs in self.results['found_processes'].values()),
            'errors': len(self.results['errors']),
            'low_risk': risk_counts['low'],
            'medium_risk': risk_counts['medium'],
            'high_risk': risk_counts['high'],
            'critical_risk': risk_counts['critical']
        }

    def export_results_to_csv(self) -> str:
        """Export results to CSV format with risk assessment"""
        rows = []

        # Nada consta
        for cpf in self.results['nada_consta']:
            risk_data = self.results['risk_assessments'].get(cpf, {})
            rows.append({
                'CPF': DataManager.format_cpf(cpf),
                'Status': 'Nada Consta',
                'Total Processos': 0,
                'Risk Score': risk_data.get('score', 0),
                'Risk Level': risk_data.get('level_label', 'Low Risk'),
                'Risk Summary': risk_data.get('summary', 'Clean record'),
                'LLM Recommendation': risk_data.get('llm_analysis', {}).get('recommendation', 'Approved'),
                'Detalhes': 'Nenhum processo encontrado'
            })

        # With processes
        for cpf, processes in self.results['found_processes'].items():
            risk_data = self.results['risk_assessments'].get(cpf, {})
            process_details = []
            for proc in processes:
                num = proc.get('numeroProcessoUnico', 'N/A')
                tribunal = proc.get('tribunal', 'N/A')
                process_details.append(f"{num} ({tribunal})")

            # Extract red flags if available
            red_flags = risk_data.get('llm_analysis', {}).get('red_flags', [])
            red_flags_str = '; '.join(red_flags) if red_flags else 'None identified'

            rows.append({
                'CPF': DataManager.format_cpf(cpf),
                'Status': 'Processos Encontrados',
                'Total Processos': len(processes),
                'Risk Score': risk_data.get('score', 0),
                'Risk Level': risk_data.get('level_label', 'Unknown'),
                'Risk Summary': risk_data.get('summary', ''),
                'LLM Recommendation': risk_data.get('llm_analysis', {}).get('recommendation', 'Review required'),
                'Red Flags': red_flags_str,
                'Detalhes': '; '.join(process_details)
            })

        # Errors
        for error in self.results['errors']:
            rows.append({
                'CPF': DataManager.format_cpf(error['cpf']),
                'Status': 'Erro',
                'Total Processos': 0,
                'Risk Score': 'N/A',
                'Risk Level': 'N/A',
                'Risk Summary': 'Error during search',
                'LLM Recommendation': 'Manual verification required',
                'Red Flags': '',
                'Detalhes': error['error']
            })

        df = pd.DataFrame(rows)
        return df.to_csv(index=False)


class UIComponents:
    """UI component rendering"""

    @staticmethod
    def render_risk_assessment(risk_data: Dict, expanded: bool = True):
        """Render risk assessment panel"""
        if not risk_data:
            return

        # Risk score header with color
        score = risk_data.get("score", 0)
        level_label = risk_data.get("level_label", "Unknown")
        emoji = risk_data.get("emoji", "❓")
        color = risk_data.get("color", "gray")

        # Color mapping for Streamlit
        color_map = {
            "green": "#28a745",
            "orange": "#fd7e14",
            "red": "#dc3545",
            "darkred": "#721c24"
        }
        hex_color = color_map.get(color, "#6c757d")

        with st.expander(f"{emoji} Risk Assessment: {level_label} (Score: {score}/100)", expanded=expanded):
            # Score visualization
            col1, col2, col3 = st.columns([2, 1, 1])

            with col1:
                st.markdown(f"""
                <div style="background-color: {hex_color}; color: white; padding: 15px; border-radius: 5px; text-align: center;">
                    <h2 style="margin: 0; color: white;">{emoji} {score}/100</h2>
                    <p style="margin: 5px 0 0 0; color: white;">{level_label}</p>
                </div>
                """, unsafe_allow_html=True)

            with col2:
                st.metric("Risk Level", level_label)

            with col3:
                process_count = risk_data.get("summary", "").split()[0]
                st.metric("Processes", process_count)

            st.markdown("---")

            # Summary
            summary = risk_data.get("summary", "")
            if summary:
                st.write(f"**Summary:** {summary}")

            # Factor breakdown
            st.subheader("Risk Factor Breakdown")
            factors = risk_data.get("factors", {})

            col1, col2 = st.columns(2)

            with col1:
                st.write("**Process Volume:**")
                process_score = factors.get("process_count_score", 0)
                st.progress(process_score / 100)
                st.caption(f"Score: {process_score:.1f}/100")

                st.write("**Case Severity:**")
                severity_score = factors.get("severity_score", 0)
                st.progress(severity_score / 100)
                st.caption(f"Score: {severity_score:.1f}/100")

            with col2:
                st.write("**Defendant Role:**")
                defendant_score = factors.get("defendant_score", 0)
                st.progress(defendant_score / 100)
                st.caption(f"Score: {defendant_score:.1f}/100")

                st.write("**Financial Exposure:**")
                financial_score = factors.get("financial_score", 0)
                st.progress(financial_score / 100)
                st.caption(f"Score: {financial_score:.1f}/100")

            # LLM Analysis
            llm_analysis = risk_data.get("llm_analysis", {})
            if llm_analysis:
                st.markdown("---")
                st.subheader("🤖 LLM Analysis")

                llm_available = llm_analysis.get("llm_available", False)
                if not llm_available:
                    st.info("💡 " + llm_analysis.get("insights", "LLM analysis not available"))
                else:
                    # Insights
                    insights = llm_analysis.get("insights", "")
                    if insights:
                        st.write("**Key Insights:**")
                        st.info(insights)

                    # Red flags
                    red_flags = llm_analysis.get("red_flags", [])
                    if red_flags:
                        st.write("**🚩 Red Flags:**")
                        for flag in red_flags:
                            st.warning(f"• {flag}")
                    else:
                        st.success("✅ No significant red flags identified")

                    # Recommendation
                    recommendation = llm_analysis.get("recommendation", "")
                    if recommendation and recommendation != "manual_review":
                        st.write("**Recommendation:**")
                        st.write(f"_{recommendation}_")

    @staticmethod
    def render_risk_badge(risk_data: Dict) -> str:
        """Render compact risk badge for inline display"""
        if not risk_data:
            return ""

        emoji = risk_data.get("emoji", "❓")
        score = risk_data.get("score", 0)
        level_label = risk_data.get("level_label", "Unknown")

        return f"{emoji} **{level_label}** ({score}/100)"

    @staticmethod
    def render_login_screen():
        """Render login screen"""
        st.markdown("""
        <style>
        .login-container {
            max-width: 400px;
            margin: 0 auto;
            padding: 2rem;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            background-color: #f8f9fa;
        }
        .login-title {
            text-align: center;
            color: #1f77b4;
            margin-bottom: 2rem;
        }
        </style>
        """, unsafe_allow_html=True)

        with st.container():
            _, col2, _ = st.columns([1, 2, 1])

            with col2:
                st.markdown('<div class="login-container">', unsafe_allow_html=True)
                st.markdown('<h1 class="login-title">🔐 Login</h1>', unsafe_allow_html=True)
                st.markdown('<h3 style="text-align: center; color: #666;">Legal Process Search</h3>', unsafe_allow_html=True)
                st.markdown("---")
                
                username = st.text_input("👤 User:", placeholder="Enter your username")
                password = st.text_input("🔒 Password:", type="password", placeholder="Enter your password")
                
                st.markdown("<br>", unsafe_allow_html=True)
                
                if st.button("🚀 Login", type="primary", use_container_width=True):
                    if not username or not password:
                        st.error("❌ Please fill in all fields!")
                    elif AuthenticationManager.verify_credentials(username, password):
                        st.session_state.authenticated = True
                        st.session_state.username = username
                        st.session_state.login_time = datetime.now()
                        
                        if "ph" not in st.session_state:
                            st.session_state.ph = PosthogAPI()
                        
                        st.session_state.ph.set_user(
                            username, 
                            {"login_time": datetime.now().isoformat()}
                        )
                        
                        st.success("✅ Login successful!")
                        st.rerun()
                    else:
                        st.error("❌ Invalid username or password!")
                
                st.markdown("---")
                st.markdown('</div>', unsafe_allow_html=True)

    @staticmethod
    def render_user_info():
        """Render user information in sidebar"""
        if AuthenticationManager.is_authenticated():
            with st.sidebar:
                st.markdown("---")
                st.markdown("### 👤 Logged User")
                st.write(f"**User:** {st.session_state.username}")
                
                login_time = st.session_state.get('login_time')
                if login_time:
                    st.write(f"**Login:** {login_time.strftime('%d/%m/%Y %H:%M')}")
                
                if st.button("🚪 Logout", use_container_width=True):
                    AuthenticationManager.logout()

    @staticmethod
    def render_process_movements(movements: List[Dict]):
        """Render process movements"""
        if not movements:
            st.info("No process movements found.")
            return
        
        st.subheader(f"Process Movements ({len(movements)} movements)")
        
        for mov in sorted(movements, key=lambda x: x.get('data', ''), reverse=True):
            date = DataManager.format_date(mov.get('data'))
            classification = DataManager.clean_text(
                mov.get('classificacaoCNJ', {}).get('nome', 'N/A')
            )
            description = DataManager.clean_text(mov.get('descricao', ''))
            
            with st.expander(f"{date} - {classification}", expanded=False):
                col1, col2 = st.columns(2)
                
                with col1:
                    st.write(f"**Index:** {mov.get('indice', 'N/A')}")
                    st.write(f"**CNJ Code:** {mov.get('classificacaoCNJ', {}).get('codigoCNJ', '')}")
                
                with col2:
                    st.write(f"**Date:** {date}")
                    st.write(f"**Classification:** {classification}")
                
                if description:
                    st.write("**Description:**")
                    st.write(description)

    @staticmethod
    def render_process_details(process: Dict, index: int):
        """Render detailed process information"""
        process_number = process.get('numeroProcessoUnico', 'N/A')
        details_key = f"detalhes_{process_number}"
        has_details = details_key in st.session_state
        
        # Build title
        if has_details:
            movements_count = len(st.session_state[details_key].get('movimentos', []))
            title_suffix = f" (DETAILS LOADED - {movements_count} movements)" if movements_count else " (DETAILS LOADED)"
            title = f"Process: {process_number}{title_suffix}"
        else:
            title = f"Process: {process_number}"
        
        with st.expander(title, expanded=False):
            # Basic information
            col1, col2 = st.columns(2)
            
            with col1:
                st.subheader("Court Information")
                st.write(f"**Court:** {DataManager.clean_text(process.get('tribunal', 'N/A'))}")
                st.write(f"**State:** {process.get('uf', 'N/A')}")
                st.write(f"**Judge:** {DataManager.clean_text(process.get('orgaoJulgador', 'N/A'))}")
                st.write(f"**Level:** {process.get('grauProcesso', 'N/A')}")
            
            with col2:
                st.subheader("Dates")
                st.write(f"**Distribution:** {DataManager.format_date(process.get('dataDistribuicao'))}")
                st.write(f"**Filing:** {DataManager.format_date(process.get('dataAutuacao'))}")
            
            # Class and subjects
            process_class = process.get('classeProcessual', {})
            if process_class:
                st.write(f"**Class:** {DataManager.clean_text(process_class.get('nome', 'N/A'))}")
            
            subjects = process.get('assuntosCNJ', [])
            if subjects:
                st.write("**Subjects:**")
                for subject in subjects:
                    is_main = "Main" if subject.get('ePrincipal') else "Secondary"
                    title = DataManager.clean_text(subject.get('titulo', 'N/A'))
                    st.write(f"  {is_main}: {title}")
            
            # Case value
            case_value = process.get('valorCausa', {})
            if case_value:
                st.write(f"**Case Value:** {DataManager.format_currency(case_value.get('valor'))}")
            
            # Parties
            st.subheader("Parties")
            for party in process.get('partes', []):
                party_type = DataManager.clean_text(party.get('tipo', 'N/A'))
                name = DataManager.clean_text(party.get('nome', 'N/A'))
                doc = party.get('cpf') or party.get('cnpj', '')
                doc_info = f" (CPF/CNPJ: {doc})" if doc else ""
                st.write(f"**{party_type}:** {name}{doc_info}")
                
                # Lawyers
                for lawyer in party.get('advogados', []):
                    lawyer_name = DataManager.clean_text(lawyer.get('nome', 'N/A'))
                    oab = lawyer.get('oab', {})
                    oab_info = f"OAB/{oab.get('uf')}: {oab.get('numero')}" if oab else ""
                    st.write(f"  {lawyer_name} {oab_info}")
            
            # URL
            process_url = process.get('urlProcesso')
            if process_url:
                st.write(f"[Access on court website]({process_url})")
            
            # Movements
            movements = process.get('movimentos', [])
            if has_details:
                detailed_movements = st.session_state[details_key].get('movimentos', [])
                if len(detailed_movements) > len(movements):
                    movements = detailed_movements
            
            if movements:
                UIComponents.render_process_movements(movements)
            else:
                if st.button("Get Details", key=f"btn_details_{process_number}_{index}"):
                    UIComponents._fetch_process_details(process_number)

    @staticmethod
    def _fetch_process_details(process_number: str):
        """Fetch detailed process information"""
        api = st.session_state.get('api') or PredictusAPI()
        st.session_state.api = api

        with st.spinner("Fetching details..."):
            details = api.search_by_process_number(process_number)

            if details and len(details) > 0:
                detailed_process = details[0]
                details_key = f"detalhes_{process_number}"
                st.session_state[details_key] = detailed_process

                DataManager.save_process_details(process_number, detailed_process)

                movements = detailed_process.get('movimentos', [])
                if movements:
                    st.success(f"✅ Found {len(movements)} movements! 💾 Details saved.")
                    UIComponents.render_process_movements(movements)
                else:
                    st.success("✅ Process consulted and saved! No additional movements.")

                # Force re-render
                update_key = f"update_{process_number}"
                if update_key not in st.session_state:
                    st.session_state[update_key] = True
                    st.rerun()
            else:
                st.warning("Could not obtain process details.")

    @staticmethod
    def render_bulk_search_results(bulk_results: Dict):
        """Render results from bulk CPF search"""
        if not bulk_results:
            return

        manager = BulkSearchManager(None, None)
        manager.results = bulk_results
        summary_stats = manager.get_summary()

        # Summary metrics
        st.subheader("📊 Bulk Search Summary")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("Total Searched", summary_stats['total_searched'])
        with col2:
            st.metric("✅ Nada Consta", summary_stats['nada_consta'])
        with col3:
            st.metric("⚠️ With Processes", summary_stats['with_processes'])
        with col4:
            st.metric("📋 Total Processes", summary_stats['total_processes'])

        # Risk summary metrics
        st.subheader("🎯 Risk Assessment Summary")
        col1, col2, col3, col4 = st.columns(4)

        with col1:
            st.metric("✅ Low Risk", summary_stats.get('low_risk', 0))
        with col2:
            st.metric("⚠️ Medium Risk", summary_stats.get('medium_risk', 0))
        with col3:
            st.metric("🔴 High Risk", summary_stats.get('high_risk', 0))
        with col4:
            st.metric("⛔ Critical Risk", summary_stats.get('critical_risk', 0))

        # Export button
        if summary_stats['total_searched'] > 0:
            csv_data = manager.export_results_to_csv()
            st.download_button(
                label="📥 Download Results (CSV)",
                data=csv_data,
                file_name=f"bulk_search_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv",
                use_container_width=True
            )

        st.markdown("---")

        # Nada Consta section
        if bulk_results['nada_consta']:
            with st.expander(f"✅ Nada Consta ({len(bulk_results['nada_consta'])} CPFs)", expanded=True):
                st.success(f"**{len(bulk_results['nada_consta'])}** CPFs without judicial processes")

                # Display in columns for better readability with risk badges
                cpf_list = bulk_results['nada_consta']
                risk_assessments = bulk_results.get('risk_assessments', {})

                for cpf in cpf_list:
                    risk_data = risk_assessments.get(cpf, {})
                    risk_badge = UIComponents.render_risk_badge(risk_data)
                    st.write(f"✓ {DataManager.format_cpf(cpf)} - {risk_badge}")

        # Found processes section
        if bulk_results['found_processes']:
            st.markdown("---")
            st.subheader(f"⚠️ CPFs with Processes ({len(bulk_results['found_processes'])})")

            risk_assessments = bulk_results.get('risk_assessments', {})

            for cpf, processes in bulk_results['found_processes'].items():
                risk_data = risk_assessments.get(cpf, {})
                risk_badge = UIComponents.render_risk_badge(risk_data)

                with st.expander(f"CPF: {DataManager.format_cpf(cpf)} - {len(processes)} process(es) - {risk_badge}", expanded=False):
                    st.warning(f"**{len(processes)} judicial process(es) found for this CPF**")

                    # Display risk assessment
                    if risk_data:
                        UIComponents.render_risk_assessment(risk_data, expanded=False)
                        st.markdown("---")

                    # Display each process
                    for idx, process in enumerate(processes):
                        UIComponents.render_process_details(process, idx)

        # Errors section
        if bulk_results['errors']:
            st.markdown("---")
            with st.expander(f"❌ Errors ({len(bulk_results['errors'])})", expanded=False):
                st.error(f"**{len(bulk_results['errors'])}** CPFs had errors during search")

                for error in bulk_results['errors']:
                    st.write(f"• {DataManager.format_cpf(error['cpf'])}: {error['error']}")


def initialize_session_state():
    """Initialize session state variables"""
    defaults = {
        'resultados': None,
        'historico_pesquisas': DataManager.load_search_history(),
        'ph': PosthogAPI()
    }
    
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_bulk_search_interface():
    """Render the bulk search interface for CSV uploads"""
    st.subheader("Bulk CPF Search via CSV")

    st.markdown("""
    Upload a CSV file containing CPFs to search multiple records at once.
    The system will automatically extract all CPFs from the file.
    """)

    # File upload
    uploaded_file = st.file_uploader(
        "Choose a CSV file",
        type=['csv'],
        help="Upload a CSV file containing CPFs. Maximum file size: 10MB"
    )

    if uploaded_file is not None:
        # Validate file
        is_valid, message = CSVProcessor.validate_csv_file(uploaded_file)

        if not is_valid:
            st.error(f"❌ {message}")
            return

        # Process CSV
        with st.spinner("Processing CSV file..."):
            cpf_list, _ = CSVProcessor.process_csv_file(uploaded_file)

        if not cpf_list:
            st.warning("⚠️ No valid CPFs found in the uploaded file.")
            return

        # Display preview
        st.success(f"✅ Found {len(cpf_list)} unique CPFs in the file")

        with st.expander("📋 Preview extracted CPFs", expanded=False):
            # Format CPFs for display
            formatted_cpfs = [DataManager.format_cpf(cpf) for cpf in cpf_list[:50]]

            if len(cpf_list) <= 50:
                st.write(", ".join(formatted_cpfs))
            else:
                st.write(", ".join(formatted_cpfs))
                st.info(f"... and {len(cpf_list) - 50} more CPFs")

        # Search button
        col1, col2 = st.columns([1, 3])

        with col1:
            if st.button("🔍 Start Bulk Search", type="primary", use_container_width=True):
                perform_bulk_search(cpf_list)

        with col2:
            st.info(f"This will search {len(cpf_list)} CPFs. This may take several minutes.")

    # Display previous bulk search results if available
    if 'bulk_results' in st.session_state and st.session_state.bulk_results:
        st.markdown("---")
        st.subheader("📊 Last Bulk Search Results")
        UIComponents.render_bulk_search_results(st.session_state.bulk_results)


def perform_bulk_search(cpf_list: List[str]):
    """Perform bulk CPF search"""
    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    posthog = st.session_state.get('ph') or PosthogAPI()
    st.session_state.ph = posthog

    # Create bulk search manager
    bulk_manager = BulkSearchManager(api, posthog)

    # Progress tracking
    progress_bar = st.progress(0)
    status_text = st.empty()

    def update_progress(current: int, total: int, cpf: str):
        """Update progress bar and status"""
        progress = current / total
        progress_bar.progress(progress)
        status_text.text(f"Searching {current}/{total}: {DataManager.format_cpf(cpf)}")

    # Perform search
    with st.spinner("Performing bulk search..."):
        results = bulk_manager.search_cpf_list(cpf_list, progress_callback=update_progress)

    # Clear progress indicators
    progress_bar.empty()
    status_text.empty()

    # Store results
    st.session_state.bulk_results = results

    # Display summary
    summary = bulk_manager.get_summary()
    st.success(f"✅ Bulk search completed! Searched {summary['total_searched']} CPFs")

    # Rerun to display results
    st.rerun()


def render_search_interface():
    """Render the main search interface"""
    st.title("Legal Process Search")
    st.markdown("---")

    # Create tabs for single and bulk search
    tab1, tab2 = st.tabs(["🔍 Single Search", "📂 Bulk Search (CSV)"])

    with tab1:
        st.subheader("Search by Name or CPF")

        col1, col2 = st.columns([3, 1])

        with col1:
            search_input = st.text_input(
                "Full name or CPF:",
                placeholder="Ex: João Silva or 123.456.789-10"
            )

        with col2:
            if st.button("🔍 New Search", type="primary", use_container_width=True):
                if not search_input.strip():
                    st.warning("Enter a name or CPF to search.")
                    return

                perform_search(search_input)

    with tab2:
        render_bulk_search_interface()


def perform_search(search_input: str):
    """Perform search based on input"""
    api = st.session_state.get('api') or PredictusAPI()
    st.session_state.api = api

    # Clear previous risk assessment
    st.session_state.risk_assessment = None

    with st.spinner("Searching processes..."):
        if DataManager.is_cpf(search_input):
            cpf = re.sub(r'\D', '', search_input)
            st.info(f"Searching by CPF: {cpf}")
            results = api.search_by_cpf(cpf)
            search_type, display_term = "CPF", cpf
        else:
            st.info(f"Searching by name: {search_input}")
            results = api.search_by_name(search_input)
            search_type, display_term = "Name", search_input

        st.session_state.ph.track_search(search_input, is_new=True)

    st.session_state.resultados = results
    st.session_state.last_search_term = display_term

    if results is not None:
        search_info = {
            'termo': display_term,
            'tipo': search_type,
            'data_hora': datetime.now().strftime('%d/%m/%Y %H:%M'),
            'total_processos': len(results),
            'resultados': results
        }

        st.session_state.historico_pesquisas.insert(0, search_info)
        if len(st.session_state.historico_pesquisas) > MAX_HISTORY_ITEMS:
            st.session_state.historico_pesquisas = st.session_state.historico_pesquisas[:MAX_HISTORY_ITEMS]

        if DataManager.save_search_history(st.session_state.historico_pesquisas):
            st.success("✅ Search saved to permanent history!")


def render_search_results():
    """Render search results"""
    if st.session_state.resultados is None:
        return

    results = st.session_state.resultados

    if len(results) == 0:
        st.warning("No processes found.")

        # Even for clean records, show risk assessment
        if 'risk_assessment' not in st.session_state or st.session_state.risk_assessment is None:
            risk_assessor = RiskAssessor()
            search_term = st.session_state.get('last_search_term', 'N/A')
            risk_data = risk_assessor.assess_risk([], {"search_term": search_term})
            st.session_state.risk_assessment = risk_data

        UIComponents.render_risk_assessment(st.session_state.risk_assessment, expanded=True)
        return

    st.success(f"Found {len(results)} processes")

    # Calculate risk assessment
    if 'risk_assessment' not in st.session_state or st.session_state.risk_assessment is None:
        with st.spinner("Analyzing risk factors..."):
            risk_assessor = RiskAssessor()
            search_term = st.session_state.get('last_search_term', 'N/A')
            risk_data = risk_assessor.assess_risk(results, {"search_term": search_term})
            st.session_state.risk_assessment = risk_data

    # Display risk assessment
    UIComponents.render_risk_assessment(st.session_state.risk_assessment, expanded=True)

    st.markdown("---")

    # Statistics
    courts = {}
    total_value = 0

    for proc in results:
        court = proc.get('tribunal', 'N/A')
        courts[court] = courts.get(court, 0) + 1

        value = proc.get('valorCausa', {}).get('valor', 0)
        if value:
            try:
                total_value += float(value)
            except (ValueError, TypeError):
                pass

    col1, col2, col3 = st.columns(3)
    with col1:
        st.metric("Total", len(results))
    with col2:
        main_court = max(courts, key=courts.get) if courts else "N/A"
        st.metric("Main Court", main_court)
    with col3:
        st.metric("Total Value", DataManager.format_currency(total_value))

    st.markdown("---")
    st.subheader("📋 Found Processes")

    for i, process in enumerate(results):
        UIComponents.render_process_details(process, i)


def render_sidebar():
    """Render sidebar with information and history"""
    with st.sidebar:
        st.header("Information")
        st.markdown("""
        **How to use:**
        1. Enter full name or CPF
        2. Click "Search"
        3. Navigate through processes
        4. Use "Get Details" for movements
        
        **Features:**
        - 💾 History saved automatically
        - 🔄 Searches + details persist after reload
        - 🔍 Search by name or CPF
        - 📋 Complete process details
        - ⚖️ Saved process movements
        """)
        
        render_search_history()
        UIComponents.render_user_info()


def render_search_history():
    """Render search history in sidebar"""
    st.markdown("---")
    st.header("Search History")
    
    history = st.session_state.historico_pesquisas
    
    if not history:
        st.info("No searches saved yet.")
        st.caption("💾 Searches and details are saved automatically")
        return
    
    st.write(f"**{len(history)} saved searches**")
    st.caption("💾 History saved automatically")
    
    for i, search in enumerate(history):
        details_count = len(search.get('detalhes_processos', {}))
        details_info = f" + {details_count} detailed" if details_count > 0 else ""
        term_display = search['termo'][:20] + ('...' if len(search['termo']) > 20 else '')
        
        with st.expander(f"{search['tipo']}: {term_display}", expanded=False):
            st.write(f"**Type:** {search['tipo']}")
            st.write(f"**Term:** {search['termo']}")
            st.write(f"**Date/Time:** {search['data_hora']}")
            st.write(f"**Processes:** {search['total_processos']}{details_info}")
            
            if details_count > 0:
                st.write(f"**💾 Details saved:** {details_count} processes")
            
            col1, col2 = st.columns(2)
            
            with col1:
                if st.button("📂 Open", key=f"reopen_{i}"):
                    reopen_search(search, i)
            
            with col2:
                if st.button("🗑️ Delete", key=f"delete_{i}"):
                    delete_search(search, i)


def reopen_search(search: Dict, _index: int):
    """Reopen a saved search"""
    st.session_state.resultados = search['resultados']

    # Load saved details
    details_processes = search.get('detalhes_processos', {})
    for process_number, details in details_processes.items():
        st.session_state[f"detalhes_{process_number}"] = details

    details_count = len(details_processes)
    if details_count > 0:
        st.success(f"Search opened: {search['total_processos']} processes + {details_count} with saved details")
    else:
        st.success(f"Search opened: {search['total_processos']} processes")

    st.session_state.ph.track_search(search['termo'], is_new=False)
    st.rerun()


def delete_search(search: Dict, index: int):
    """Delete a search from history"""
    st.session_state.historico_pesquisas.pop(index)

    if DataManager.save_search_history(st.session_state.historico_pesquisas):
        st.success(f"✅ Search '{search['termo']}' deleted from history!")
    else:
        st.error("❌ Error deleting search from file.")

    st.rerun()


def main_app():
    """Main application after login"""
    initialize_session_state()
    render_search_interface()
    render_search_results()
    render_sidebar()


def main():
    """Main function controlling authentication flow"""
    st.set_page_config(
        page_title="Legal Process Search MVP",
        page_icon="⚖️",
        layout="wide"
    )

    if "ph" not in st.session_state:
        st.session_state.ph = PosthogAPI()

    if not AuthenticationManager.is_authenticated():
        UIComponents.render_login_screen()
    else:
        main_app()


if __name__ == "__main__":
    main()