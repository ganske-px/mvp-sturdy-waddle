#!/bin/bash

# ===========================================
# Consulta de Processos Judiciais - Deploy Script
# ===========================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Consulta de Processos Judiciais MVP  ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for Python 3
echo -e "${YELLOW}[1/5] Checking Python installation...${NC}"
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    PYTHON_VERSION=$(python3 --version 2>&1)
    echo -e "${GREEN}✓ Found: $PYTHON_VERSION${NC}"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    PYTHON_VERSION=$(python --version 2>&1)
    echo -e "${GREEN}✓ Found: $PYTHON_VERSION${NC}"
else
    echo -e "${RED}✗ Python 3 is required but not installed.${NC}"
    echo -e "${RED}  Please install Python 3.11 or higher.${NC}"
    exit 1
fi

# Create virtual environment if it doesn't exist
echo ""
echo -e "${YELLOW}[2/5] Setting up virtual environment...${NC}"
if [ ! -d "venv" ]; then
    echo -e "  Creating virtual environment..."
    $PYTHON_CMD -m venv venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
else
    echo -e "${GREEN}✓ Virtual environment already exists${NC}"
fi

# Activate virtual environment
echo ""
echo -e "${YELLOW}[3/5] Activating virtual environment...${NC}"
source venv/bin/activate
echo -e "${GREEN}✓ Virtual environment activated${NC}"

# Install/upgrade dependencies
echo ""
echo -e "${YELLOW}[4/5] Installing dependencies...${NC}"
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Setup secrets configuration
echo ""
echo -e "${YELLOW}[5/5] Checking secrets configuration...${NC}"

STREAMLIT_DIR=".streamlit"
SECRETS_FILE="$STREAMLIT_DIR/secrets.toml"

if [ ! -d "$STREAMLIT_DIR" ]; then
    echo -e "  Creating .streamlit directory..."
    mkdir -p "$STREAMLIT_DIR"
fi

if [ ! -f "$SECRETS_FILE" ]; then
    if [ -f "secrets.toml.example" ]; then
        echo -e "  Copying secrets.toml.example to $SECRETS_FILE..."
        cp secrets.toml.example "$SECRETS_FILE"
        echo -e "${YELLOW}⚠ IMPORTANT: Edit $SECRETS_FILE with your credentials!${NC}"
    else
        echo -e "${RED}✗ secrets.toml.example not found!${NC}"
        echo -e "${RED}  Please create $SECRETS_FILE manually.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✓ Secrets file already configured${NC}"
fi

# Display info
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Starting Streamlit application..."
echo -e "Access the app at: ${GREEN}http://localhost:8501${NC}"
echo -e "Press ${RED}Ctrl+C${NC} to stop the server"
echo ""

# Run the Streamlit application
streamlit run app.py \
    --server.port 8501 \
    --server.address localhost \
    --server.headless true \
    --browser.gatherUsageStats false
