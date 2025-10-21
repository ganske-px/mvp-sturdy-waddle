"""
Predictus API Model
Handles API communication with Predictus service
"""
import requests
import streamlit as st
from typing import Dict, List, Optional
from config.settings import PREDICTUS_BASE_URL, REQUEST_TIMEOUT


class PredictusAPI:
    """Handles API communication with Predictus service"""

    def __init__(self):
        self.base_url = PREDICTUS_BASE_URL
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
        return self._make_request(
            "/predictus-api/processos/judiciais/buscarPorNomeParte",
            {"nome": name.upper()}
        )

    def search_by_cpf(self, cpf: str) -> Optional[List[Dict]]:
        """Search processes by CPF"""
        return self._make_request(
            "/predictus-api/processos/judiciais/buscarPorCPFParte",
            {"cpf": cpf}
        )

    def search_by_process_number(self, process_number: str) -> Optional[List[Dict]]:
        """Search process by CNJ number"""
        return self._make_request(
            "/predictus-api/processos/judiciais/buscarPorNumeroCNJ",
            {"numeroProcessoUnico": process_number}
        )
