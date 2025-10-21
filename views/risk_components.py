"""
Risk Assessment View Components
UI components for displaying risk assessment information
"""
import streamlit as st
from typing import Dict


class RiskViewComponents:
    """UI components for risk assessment display"""

    @staticmethod
    def render_risk_assessment(risk_data: Dict, expanded: bool = True):
        """Render comprehensive risk assessment panel"""
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
