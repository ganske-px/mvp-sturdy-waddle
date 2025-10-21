# Quick Setup Guide - Risk Assessment with Gemini

## 5-Minute Setup

### Step 1: Get Your Free Gemini API Key

1. Go to: **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the API key (starts with `AIza...`)

### Step 2: Configure Your Application

1. Open or create `.streamlit/secrets.toml` in your project root
2. Add these lines:

```toml
GEMINI_API_KEY = "AIza...your-actual-key-here..."
GEMINI_MODEL = "gemini-1.5-flash"
```

3. Save the file

### Step 3: Install Dependencies

```bash
pip install google-generativeai==0.8.3
```

Or install all requirements:

```bash
pip install -r requirements.txt
```

### Step 4: Run the Application

```bash
streamlit run app.py
```

### Step 5: Test It

1. Login to the application
2. Search for a name or CPF
3. Look for the "Risk Assessment" panel in the results
4. You should see:
   - Risk score (0-100)
   - Risk level (Low/Medium/High/Critical)
   - LLM-generated insights
   - Red flags (if any)
   - Recommendation

## Troubleshooting

### "LLM analysis unavailable" Error

**Check 1**: Is your API key configured?
```bash
# Open secrets.toml and verify GEMINI_API_KEY is set
cat .streamlit/secrets.toml | grep GEMINI_API_KEY
```

**Check 2**: Is your API key valid?
- Visit https://aistudio.google.com/app/apikey
- Verify your key is active
- Try creating a new key if needed

**Check 3**: Did you install the dependency?
```bash
pip list | grep google-generativeai
# Should show: google-generativeai 0.8.3 (or similar)
```

### Rate Limit Errors

Free tier limits:
- 15 requests per minute
- 1,500 requests per day

If you hit limits:
1. Wait a few minutes and retry
2. For bulk searches, they automatically pace requests
3. Consider upgrading to paid tier for higher limits

### Import Error

If you see `ModuleNotFoundError: No module named 'google.generativeai'`:

```bash
pip install google-generativeai==0.8.3
```

## What Gets Analyzed?

The risk assessment evaluates:

1. **Number of processes** - More processes = higher risk
2. **Role in cases** - Defendant = higher risk than plaintiff
3. **Case types** - Criminal > Labor > Civil > Family
4. **Financial exposure** - Total monetary values in cases

Plus AI-powered insights that consider:
- Patterns across cases
- Severity of allegations
- Recent vs old cases
- Context-specific risk factors

## Model Options

Edit `GEMINI_MODEL` in `secrets.toml`:

```toml
# Fast and efficient (recommended for most use cases)
GEMINI_MODEL = "gemini-1.5-flash"

# Highest quality (slower, more detailed analysis)
GEMINI_MODEL = "gemini-1.5-pro"

# Fastest (good for high volume)
GEMINI_MODEL = "gemini-1.5-flash-8b"
```

## Security Best Practices

1. **Never commit secrets.toml to git**
   ```bash
   # It should already be in .gitignore
   echo ".streamlit/secrets.toml" >> .gitignore
   ```

2. **Keep your API key private**
   - Don't share in emails or chat
   - Don't hardcode in source files
   - Rotate periodically

3. **Monitor usage**
   - Check usage at: https://aistudio.google.com
   - Set up alerts for unusual activity

## Cost Information

**Free Tier** (No credit card required):
- Perfect for development and testing
- 1,500 requests per day
- Enough for ~1,500 employee checks per day

**Paid Tier** (If you need more):
- gemini-1.5-flash: ~$0.00015 per analysis
- That's $15 for 100,000 employee checks
- Only pay for what you use

## Next Steps

1. ✅ Complete setup above
2. 📖 Read full documentation: `RISK_ASSESSMENT_README.md`
3. 🧪 Test with sample data
4. 🚀 Use for employee background checks
5. 📊 Export results with risk scores to CSV

## Support

Need help?
- Check `RISK_ASSESSMENT_README.md` for detailed docs
- Review error messages in the Streamlit app
- Verify Google Cloud status: https://status.cloud.google.com
- Open an issue in the repository

---

**Setup Time**: 5 minutes
**Cost**: Free (up to 1,500 checks/day)
**Difficulty**: Easy
