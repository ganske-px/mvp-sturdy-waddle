# Risk Assessment System - Know Your Employee (KYE)

## Overview

This system implements an intelligent risk assessment feature for employee background checks using Google Gemini AI. It analyzes judicial process data to evaluate employment risk based on industry-standard Know-Your-Employee (KYE) patterns.

## Features

### 🤖 Google Gemini LLM Integration
- **Fast & Reliable**: Uses Google's Gemini API for state-of-the-art AI analysis
- **Free Tier Available**: Generous free quota (15 requests/minute, 1500 requests/day)
- **Multiple Models**: Support for gemini-1.5-flash, gemini-1.5-pro, gemini-1.5-flash-8b
- **Low Latency**: Optimized API with fast response times
- **Secure**: Enterprise-grade security from Google Cloud

### 📊 Multi-Factor Risk Scoring

The system calculates risk scores (0-100) based on four key factors:

1. **Process Count Score (25% weight)**
   - Number of judicial processes
   - Scoring: 1 process = 20, 2 = 35, 3-5 = 50, 6-10 = 70, 10+ = 70+

2. **Defendant Role Score (30% weight)**
   - Percentage of cases where person is defendant
   - Higher risk for defendants vs plaintiffs
   - Keywords: "réu", "executado", "demandado"

3. **Case Severity Score (25% weight)**
   - Type of legal cases involved
   - Criminal/Penal: 100 (highest risk)
   - Labor (Trabalhista): 70
   - Execution (Execução): 60
   - Civil: 40
   - Family/Consumer: 25-30

4. **Financial Exposure Score (20% weight)**
   - Total monetary value of cases
   - Thresholds (BRL):
     - < 10k: 20
     - 10k-50k: 35
     - 50k-100k: 50
     - 100k-500k: 70
     - 500k+: 70+

### 🎯 Risk Levels

| Level | Score Range | Color | Meaning |
|-------|-------------|-------|---------|
| ✅ Low | 0-25 | Green | Minimal/no concerns - approve |
| ⚠️ Medium | 26-50 | Orange | Some concerns - review recommended |
| 🔴 High | 51-75 | Red | Significant concerns - careful review |
| ⛔ Critical | 76-100 | Dark Red | Major red flags - high caution |

### 🔍 LLM Analysis

For each search, the LLM provides:
- **Key Insights**: 2-3 bullet points about main findings
- **Red Flags**: Specific concerns identified
- **Recommendation**: Clear guidance (approve/review/reject)
- **Context-Aware**: Understands Brazilian legal system and KYE best practices

## Setup Instructions

### 1. Get a Gemini API Key (Free)

1. Visit: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

**Free Tier Limits:**
- 15 requests per minute
- 1,500 requests per day
- 1 million tokens per day

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

This will install `google-generativeai==0.8.3` along with other dependencies.

### 3. Configure Secrets

Add to `.streamlit/secrets.toml`:

```toml
# Google Gemini Configuration
GEMINI_API_KEY = "your_actual_api_key_here"
GEMINI_MODEL = "gemini-1.5-flash"
```

**Model Options:**
- `gemini-1.5-flash` (Recommended): Fast, efficient, good quality
- `gemini-1.5-pro`: Higher quality, slower, more expensive
- `gemini-1.5-flash-8b`: Fastest, smallest, good for high volume

### 4. Test the Integration

The system will automatically test the Gemini connection when you run a search. If there's an issue, you'll see a warning message with instructions.

## Usage

### Single Search
1. Search for a person by name or CPF
2. Risk assessment automatically runs after results load
3. View comprehensive risk panel with:
   - Overall risk score and level
   - Factor breakdown with progress bars
   - LLM-generated insights and red flags
   - Employment recommendation

### Bulk Search (CSV)
1. Upload CSV file with CPFs
2. System processes each CPF with risk assessment
3. View aggregate risk statistics:
   - Count by risk level (Low/Medium/High/Critical)
   - Individual risk badges for each CPF
   - Detailed risk panels for CPFs with processes
4. Export results to CSV including:
   - Risk scores and levels
   - LLM recommendations
   - Red flags identified
   - Complete process details

## Architecture

### Classes

#### `RiskAssessmentLLM`
Handles Google Gemini API integration.

**Key Methods:**
- `is_available()`: Check if Gemini API is configured
- `analyze_processes()`: Send data to Gemini for analysis
- `_prepare_process_summary()`: Extract key metrics for LLM
- `_build_analysis_prompt()`: Craft specialized KYE prompt
- `_parse_llm_response()`: Extract structured insights from Gemini

#### `RiskAssessor`
Calculates quantitative risk scores and coordinates LLM analysis.

**Key Methods:**
- `assess_risk()`: Main entry point - returns complete risk assessment
- `_calculate_process_count_score()`: Score based on volume
- `_calculate_defendant_score()`: Score based on role
- `_calculate_severity_score()`: Score based on case types
- `_calculate_financial_score()`: Score based on monetary exposure
- `_get_risk_level()`: Convert score to level with color/emoji

### UI Components

#### `UIComponents.render_risk_assessment()`
Displays comprehensive risk panel with:
- Color-coded header with score
- Factor breakdown with progress bars
- LLM insights and red flags
- Recommendation text

#### `UIComponents.render_risk_badge()`
Compact inline risk display for lists and summaries.

### Integration Points

1. **Single Search**: `render_search_results()` in app.py:1490
   - Calculates risk after search completes
   - Stores in `st.session_state.risk_assessment`
   - Displays at top of results

2. **Bulk Search**: `BulkSearchManager.search_cpf_list()` in app.py:807
   - Calculates risk for each CPF in batch
   - Stores in `results['risk_assessments']` dict
   - Displays in aggregate summary and detail views

3. **CSV Export**: `BulkSearchManager.export_results_to_csv()` in app.py:867
   - Includes risk score, level, summary
   - Adds LLM recommendation and red flags
   - Maintains all original data

## Customization

### Adjust Risk Weights

Edit `RiskAssessor.WEIGHTS` in app.py:259:

```python
WEIGHTS = {
    "process_count": 0.25,      # 25% weight
    "defendant_role": 0.30,     # 30% weight
    "case_severity": 0.25,      # 25% weight
    "financial_exposure": 0.20  # 20% weight
}
```

### Modify Case Severity Scores

Edit `RiskAssessor.CASE_SEVERITY` in app.py:267:

```python
CASE_SEVERITY = {
    "criminal": 100,        # Highest risk
    "penal": 100,
    "trabalhista": 70,      # Labor disputes
    "execu": 60,            # Executions
    "civil": 40,
    # Add more as needed
}
```

### Change Risk Level Thresholds

Edit `_get_risk_level()` in app.py:432:

```python
if score < 25:          # Low Risk
elif score < 50:        # Medium Risk
elif score < 75:        # High Risk
else:                   # Critical Risk
```

### Customize LLM Prompt

Edit `_build_analysis_prompt()` in app.py:179 to adjust:
- Analysis focus areas
- Output format
- Risk factors to emphasize
- Language/tone

## Performance Considerations

### LLM Response Times
- **gemini-1.5-flash**: ~1-2 seconds per analysis (recommended)
- **gemini-1.5-flash-8b**: ~0.5-1 second (fastest)
- **gemini-1.5-pro**: ~2-4 seconds (highest quality)

### Bulk Search Optimization
- Risk calculations are lightweight (instant)
- Gemini API adds 1-2 seconds per CPF
- For 100 CPFs: ~3-5 minutes total
- Free tier: 15 requests/minute (4 minutes for 100 CPFs)
- Consider upgrading to paid tier for higher throughput

### Rate Limits (Free Tier)
- **Requests per Minute**: 15 (4 seconds between requests)
- **Requests per Day**: 1,500
- **Tokens per Day**: 1 million
- System automatically handles rate limiting

## Troubleshooting

### LLM Not Available
**Symptom**: "LLM analysis unavailable" message

**Solutions:**
1. Verify GEMINI_API_KEY is set in `.streamlit/secrets.toml`
2. Check API key is valid at https://aistudio.google.com/app/apikey
3. Ensure key is not still set to "your_gemini_api_key_here"
4. Test API key: Try a simple request in Google AI Studio
5. Check you haven't exceeded free tier limits (1500/day)

### Rate Limit Errors
**Symptom**: 429 error or "quota exceeded" message

**Solutions:**
1. Free tier: 15 requests/minute - wait and retry
2. Daily limit: 1500 requests/day - wait until next day
3. Consider upgrading to paid tier for higher limits
4. For bulk searches, spread requests over longer time period

### Slow LLM Responses
**Solutions:**
1. Use faster model: `gemini-1.5-flash-8b` in secrets.toml
2. Check your internet connection
3. Verify Google Cloud status: https://status.cloud.google.com/

### Incorrect Risk Scores
**Solutions:**
1. Review case type keywords in CASE_SEVERITY
2. Adjust factor weights for your use case
3. Check defendant keyword matching for Portuguese variations
4. Validate financial thresholds match your currency/context

## Privacy & Security

### Data Privacy
- ⚠️ **Cloud Processing**: Data is sent to Google's Gemini API
- ℹ️ **Google's Privacy**: Subject to Google Cloud Privacy Policy
- ✅ **No Training**: Google doesn't use API data to train public models
- ✅ **Audit Trail**: All risk decisions are transparent and reproducible
- ✅ **Encrypted Transit**: All data transmitted via HTTPS

**Important**:
- Judicial process data will be sent to Google's servers
- Consider data sensitivity and compliance requirements
- For maximum privacy, consider self-hosted alternatives
- Review Google's privacy policy: https://cloud.google.com/terms/cloud-privacy-notice

### Security Best Practices
1. Store API keys securely in `.streamlit/secrets.toml` (never commit to git)
2. Use environment variables in production
3. Restrict API key permissions to Gemini API only
4. Monitor API usage in Google AI Studio
5. Rotate API keys periodically
6. Use separate keys for dev/staging/production

## Future Enhancements

Potential improvements:
- [ ] Historical trend analysis (risk over time)
- [ ] Comparative benchmarking (vs industry averages)
- [ ] Custom risk profiles by job role/department
- [ ] Integration with HR systems (API webhooks)
- [ ] Multi-language support for international teams
- [ ] Machine learning model training on feedback
- [ ] Risk report templates (PDF export)
- [ ] Automated alerts for high-risk profiles

## Pricing

### Google Gemini API Pricing

**Free Tier** (Generous limits for development/small deployments):
- 15 requests per minute
- 1,500 requests per day
- 1 million tokens per day
- No credit card required

**Pay-as-you-go** (For production/high volume):
- gemini-1.5-flash: $0.075 per 1M input tokens, $0.30 per 1M output tokens
- gemini-1.5-pro: $1.25 per 1M input tokens, $5.00 per 1M output tokens
- gemini-1.5-flash-8b: $0.0375 per 1M input tokens, $0.15 per 1M output tokens

**Cost Estimate for 100 employee checks**:
- ~400 tokens per analysis (input + output)
- Free tier: $0 (within daily limits)
- Paid tier with flash: ~$0.015 (less than 2 cents)

Get pricing details: https://ai.google.dev/pricing

## Support

For issues or questions:
1. Check this documentation
2. Verify Gemini API key and configuration
3. Test API key in Google AI Studio
4. Check application logs in Streamlit
5. Review Google Cloud status page
6. Open issue in repository with details

## License

This risk assessment system is part of the Legal Process Search MVP project.
Powered by Google Gemini AI.

---

**Last Updated**: 2025-10-21
**Version**: 2.0.0 (Gemini)
**Model Compatibility**: Google Gemini 1.5 (flash, pro, flash-8b)
