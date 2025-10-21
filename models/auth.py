"""
Authentication Model
User authentication and session management
"""
import hashlib
import streamlit as st


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
        keys_to_clear = ['authenticated', 'username', 'login_time', 'api', 'resultados', 'risk_assessment']
        for key in keys_to_clear:
            st.session_state.pop(key, None)

        st.success("✅ Logout successful!")
        st.rerun()
