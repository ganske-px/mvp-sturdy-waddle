import json
import os
import streamlit as st
from datetime import datetime

def carregar_historico():
    try:
        if os.path.exists("historico_pesquisas.json"):
            with open("historico_pesquisas.json", "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        st.error(f"Erro ao carregar histórico: {str(e)}")
    return {"processos": [], "cnh": []}

def salvar_historico(historico):
    try:
        with open("historico_pesquisas.json", "w", encoding="utf-8") as f:
            json.dump(historico, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        st.error(f"Erro ao salvar histórico: {str(e)}")
        return False

def salvar_pesquisa_processo(termo, tipo_busca, resultados):
    historico = st.session_state.get('historico_pesquisas', {"processos": [], "cnh": []})
    
    pesquisa_info = {
        'termo': termo,
        'tipo': tipo_busca,
        'data_hora': datetime.now().strftime('%d/%m/%Y %H:%M'),
        'total_processos': len(resultados),
        'resultados': resultados
    }
    
    historico["processos"].insert(0, pesquisa_info)
    if len(historico["processos"]) > 25:
        historico["processos"] = historico["processos"][:25]
    
    st.session_state.historico_pesquisas = historico
    return salvar_historico(historico)

def salvar_pesquisa_cnh(nome, cpf, transaction_id, resultado):
    historico = st.session_state.get('historico_pesquisas', {"processos": [], "cnh": []})
    
    pesquisa_info = {
        'termo': f"{nome} - {cpf}",
        'cpf': cpf,
        'nome': nome,
        'transaction_id': transaction_id,
        'data_hora': datetime.now().strftime('%d/%m/%Y %H:%M'),
        'resultado': resultado
    }
    
    historico["cnh"].insert(0, pesquisa_info)
    if len(historico["cnh"]) > 25:
        historico["cnh"] = historico["cnh"][:25]
    
    st.session_state.historico_pesquisas = historico
    return salvar_historico(historico)

def exibir_historico_sidebar():
    with st.sidebar:
        st.header("📋 Histórico")
        
        historico = st.session_state.get('historico_pesquisas', {"processos": [], "cnh": []})
        
        # Histórico de Processos
        st.subheader("⚖️ Processos Judiciais")
        if historico.get("processos"):
            st.write(f"**{len(historico['processos'])} pesquisas**")
            
            for i, pesquisa in enumerate(historico["processos"][:5]):
                with st.expander(f"{pesquisa['tipo']}: {pesquisa['termo'][:15]}{'...' if len(pesquisa['termo']) > 15 else ''}", expanded=False):
                    st.write(f"**Data:** {pesquisa['data_hora']}")
                    st.write(f"**Processos:** {pesquisa['total_processos']}")
                    
                    if st.button("📂 Abrir", key=f"proc_{i}"):
                        st.session_state.resultados_processos = pesquisa['resultados']
                        st.session_state.tipo_consulta = "processos"
                        st.rerun()
        else:
            st.info("Nenhuma pesquisa de processos ainda.")
        
        st.markdown("---")
        
        # Histórico de CNH
        st.subheader("🚗 Consultas CNH")
        if historico.get("cnh"):
            st.write(f"**{len(historico['cnh'])} consultas**")
            
            for i, consulta in enumerate(historico["cnh"][:5]):
                with st.expander(f"CNH: {consulta['nome'][:15]}{'...' if len(consulta['nome']) > 15 else ''}", expanded=False):
                    st.write(f"**Data:** {consulta['data_hora']}")
                    st.write(f"**CPF:** {consulta['cpf']}")
                    st.write(f"**ID:** {consulta['transaction_id'][:8]}...")
                    
                    if st.button("📂 Ver Resultado", key=f"cnh_{i}"):
                        from cnh_search import analyze_driver_data
                        analyze_driver_data({'data': consulta['resultado']})
        else:
            st.info("Nenhuma consulta CNH ainda.")