import requests
import streamlit as st

class PredictusAPI:
    def __init__(self):
        self.base_url = "https://api.predictus.inf.br"
        self.token = None
        self.username = st.secrets.get("PREDICTUS_USERNAME", "motoristapx.teste")
        self.password = st.secrets.get("PREDICTUS_PASSWORD", "")
    
    def authenticate(self):
        try:
            response = requests.post(
                f"{self.base_url}/auth",
                json={"username": self.username, "password": self.password},
                headers={"Content-Type": "application/json", "User-Agent": "streamlit-app/1.0"}
            )
            if response.status_code == 200:
                self.token = response.json().get("accessToken")
                return bool(self.token)
            st.error(f"Erro na autenticação Predictus: {response.status_code}")
        except Exception as e:
            st.error(f"Erro na autenticação Predictus: {str(e)}")
        return False
    
    def _request(self, endpoint, payload):
        if not self.token and not self.authenticate():
            return None
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }
        
        try:
            response = requests.post(f"{self.base_url}{endpoint}", json=payload, headers=headers)
            if response.status_code == 401 and self.authenticate():
                headers["Authorization"] = f"Bearer {self.token}"
                response = requests.post(f"{self.base_url}{endpoint}", json=payload, headers=headers)
            return response.json() if response.status_code == 200 else None
        except Exception as e:
            st.error(f"Erro na requisição: {str(e)}")
            return None
    
    def buscar_por_nome(self, nome):
        return self._request("/predictus-api/processos/judiciais/buscarPorNomeParte", {"nome": nome.upper()})
    
    def buscar_por_cpf(self, cpf):
        return self._request("/predictus-api/processos/judiciais/buscarPorCPFParte", {"cpf": cpf})
    
    def buscar_por_numero_cnj(self, numero_processo):
        return self._request("/predictus-api/processos/judiciais/buscarPorNumeroCNJ", {"numeroProcessoUnico": numero_processo})