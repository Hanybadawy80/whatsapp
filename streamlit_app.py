import streamlit as st

# Page setup
st.set_page_config(page_title="Message Scanning Project", page_icon="📩", layout="centered")

# Title
st.title("📩 Message Scanning Project")

# Project description
st.markdown("""
### About Our Project  
We are building a system to **scan and analyze messages** for security, compliance, and automation.  
This helps organizations protect sensitive data, detect threats, and improve communication workflows.  

Our solution can:
- 🔍 Automatically scan messages for keywords, risks, or compliance issues  
- 🤖 Integrate with automation workflows for alerts and responses  
- 📊 Provide reports and dashboards for visibility  
""")

# WhatsApp link
whatsapp_number = "+15551540430"
wa_link = f"https://wa.me/{whatsapp_number[1:]}"  # remove "+" for wa.me format

st.markdown(
    f"""
    ---
    ### 📞 Contact Us  
    Have questions or want a demo?  
    👉 [Chat with us on WhatsApp]({wa_link})
    """,
    unsafe_allow_html=True
)
