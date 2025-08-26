import requests
import json
import time
import streamlit as st

class CombateFraudeAPI:
    def __init__(self):
        self.api_url = st.secrets.get("COMBATE_FRAUDE_API_URL", "https://api.combateafraude.com/v1/transactions?origin=TRUST")
        self.bearer_token = st.secrets.get("COMBATE_FRAUDE_BEARER_TOKEN", "")
        self.template_id = st.secrets.get("COMBATE_FRAUDE_TEMPLATE_ID", "")
    
    def consultar_cnh(self, cpf, name, registration_number, mother_name, birth_date):
        if not self.bearer_token or not self.template_id:
            st.error("⚠️ Configurações da API Combate à Fraude não encontradas nos secrets.")
            return None
        
        headers = {
            'Authorization': f'Bearer {self.bearer_token}',
            'Content-Type': 'application/json',
            'User-Agent': 'StreamlitApp/1.0'
        }
        
        payload = {
            "templateId": self.template_id,
            "_callbackUrl": "",
            "attributes": {
                "cpf": cpf,
                "name": name,
                "birthDate": birth_date,
                "registrationNumber": registration_number,
                "motherName": mother_name
            }
        }
        
        try:
            # Criar transação
            response = requests.post(self.api_url, headers=headers, json=payload, timeout=60)
            
            if response.status_code not in [200, 201]:
                st.error(f"Erro HTTP {response.status_code}: {response.text}")
                return None
            
            initial_data = response.json()
            transaction_id = initial_data.get('id')
            
            if not transaction_id:
                st.error("ID da transação não encontrado na resposta")
                return None
            
            st.success(f"Transação criada! ID: {transaction_id}")
            
            # Armazenar ID da transação
            if 'cnh_transaction_ids' not in st.session_state:
                st.session_state.cnh_transaction_ids = []
            st.session_state.cnh_transaction_ids.append(transaction_id)
            
            # Fazer polling
            return self._poll_transaction(transaction_id)
                
        except requests.exceptions.Timeout:
            st.error("Timeout na requisição inicial. Tente novamente.")
            return None
        except requests.exceptions.RequestException as e:
            st.error(f"Erro na requisição inicial: {str(e)}")
            return None
        except json.JSONDecodeError:
            st.error("Resposta da API não é um JSON válido")
            return None
    
    def _poll_transaction(self, transaction_id):
        base_url = self.api_url.split('/transactions')[0]
        polling_url = f"{base_url}/transactions/{transaction_id}"
        
        polling_headers = {
            'Authorization': f'Bearer {self.bearer_token}',
            'User-Agent': 'StreamlitApp/1.0'
        }
        
        max_attempts = 60
        polling_interval = 10
        attempt = 0
        
        progress_container = st.empty()
        status_container = st.empty()
        
        while attempt < max_attempts:
            attempt += 1
            
            progress_container.progress(min(attempt / max_attempts, 1.0))
            status_container.info(f"Verificando status... Tentativa {attempt}/{max_attempts}")
            
            try:
                polling_response = requests.get(polling_url, headers=polling_headers, timeout=30)
                
                if polling_response.status_code != 200:
                    time.sleep(polling_interval)
                    continue
                
                polling_data = polling_response.json()
                current_status = polling_data.get('status', 'UNKNOWN')
                
                status_container.info(f"Status atual: {current_status}")
                
                if current_status == 'APPROVED':
                    progress_container.progress(1.0)
                    return {'transaction_id': transaction_id, 'data': polling_data}
                
                elif current_status == 'REJECTED':
                    status_container.error("Transação rejeitada")
                    return {'transaction_id': transaction_id, 'data': polling_data}
                
                elif current_status in ['FAILED', 'ERROR']:
                    status_container.error(f"Erro no processamento: {current_status}")
                    return None
                
                elif current_status in ['PROCESSING', 'PENDING']:
                    time.sleep(polling_interval)
                    continue
                
                else:
                    time.sleep(polling_interval)
                    continue
                    
            except requests.exceptions.Timeout:
                time.sleep(polling_interval)
                continue
            except requests.exceptions.RequestException:
                time.sleep(polling_interval)
                continue
            except json.JSONDecodeError:
                time.sleep(polling_interval)
                continue
        
        progress_container.empty()
        status_container.error("Timeout: Processamento não completou no tempo limite (5 minutos)")
        return None