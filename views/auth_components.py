"""
Authentication View Components
UI components for login and user info display
"""
import streamlit as st
from datetime import datetime
from models.auth import AuthenticationManager
from models.analytics import PosthogAPI


class AuthViewComponents:
    """UI components for authentication"""

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
