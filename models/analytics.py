"""
Analytics Model
Handles Posthog analytics integration
"""
import streamlit as st
from typing import Dict, Optional
from posthog import Posthog, new_context, identify_context


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
