# FinOps-Bharat 🇮🇳

**FinOps-Bharat** is an open-source cloud financial management and cost optimization platform specifically tailored for Indian enterprises and cloud architectures. It allows organizations to gain real-time visibility into their AWS infrastructure, optimize spending, and implement cloud governance frameworks efficiently. 

---

## 🚀 Getting Started (End-to-End Test Guide)

Follow these step-by-step instructions to clone, configure, and launch the entire application locally for testing purposes.

### Prerequisites
Before running the application, ensure you have the following installed on your machine:
* **Git**
* **Python 3.9+** or **Node.js** (depending on your stack's primary runtime environment)
* **AWS CLI** (configured with read-only permissions for testing)

### Step 1: Clone the Repository
Open your terminal and execute the following command to clone the project:
```bash
git clone https://github.com/your-username/finops-bharat.git
cd finops-bharat
```

### Step 2: Environment Configuration
Create a `.env` file in the root directory and add your required configuration details:
```bash
cp .env.example .env
# Edit the .env file with your local configuration parameters
```

### Step 3: Install Dependencies
Install all the required application packages:
```bash
# For Python-based backends
pip install -r requirements.txt

# For Node.js-based frontends/backends
npm install
```

### Step 4: Run the Application
Launch the local development server to run the application end-to-end:
```bash
# Example execution command
python app.py
# Or if using npm: npm start
```
Once started, open your web browser and navigate to `http://localhost:3000` (or the specified local port) to interact with the user interface.

---

## 🔐 Secure User Access & Account Scanning

FinOps-Bharat is engineered with security and data privacy at its core. Enterprise-grade monitoring does not require exposing sensitive long-term credentials.

### How to Get Your AWS Account Scanned
To initiate an infrastructure cost audit, follow these simple configuration steps within your AWS Management Console:

1. **Log in** to your AWS Management Console.
2. **Navigate to IAM** (Identity and Access Management) and select **Roles**, then click **Create Role**.
3. **Select Trust Entity Type** as "AWS Account" or "Custom Trust Policy" depending on cross-account setups.
4. **Attach Read-Only Policies** (e.g., `SecurityAudit`, `ReadOnlyAccess`, or custom billing view policies) to ensure FinOps-Bharat can only read resource metadata without altering configurations.
5. **Copy the Role ARN** or note your **AWS Account ID**.
6. **Input the Identity Details** directly into the FinOps-Bharat web interface dashboard to kick off the scanning mechanism.

### 🛡️ Critical Security Note on Data Retention
> 💡 **Your data belongs to you.** Your AWS account scanning data is strictly visible to you in your active browser session **only once your current scan is completed**. Due to our stateless, security-first architecture, the moment you close the tab or refresh your browser page, **no data is retained or stored** by the application. You must re-initiate a secure session scan to view updated metrics.

### No Long-Term Credentials Required
To maintain an optimal security posture, **long-term credentials (like AWS Access Keys and Secret Keys) are strictly not required**. You can securely access and scan your cloud footprint solely via **AWS IAM Roles** or your **AWS Account ID**, ensuring your root or administrative environments remain fully isolated and protected.

---

## 📊 App Usage Guide

Once the application is up and running, end-users can leverage its core components via these steps:
1. **Access the Dashboard:** Open the application interface in your browser.
2. **Authenticate / Connect:** Head over to the *Cloud Integration* segment and provide your Role ARN or Account ID.
3. **Trigger Scan:** Click on **"Start Cloud Audit"** to let the backend scan your active resource configurations, idle resources, and underutilized nodes.
4. **Analyze Savings Opportunities:** Review detailed visual breakdowns highlighting immediate cost-saving vectors, such as unattached EBS volumes, idle EC2 instances, and localized pricing tiers optimized for Indian regions.

---

## 🗑️ Application Deletion Guide (Cost & Resource Cleanup)

If you are finished testing the platform and want to completely teardown the infrastructure to save local or cloud costs, follow this cleanup routine:

### Local Cleanup
1. **Stop the dev server:** Press `CTRL + C` in your terminal window where the app is running.
2. **Remove the repository folder:**
   ```bash
   cd ..
   rm -rf finops-bharat
   ```

### AWS Cloud Cleanup
If you created any IAM components or resources during testing:
1. Navigate back to the **AWS IAM Console**.
2. Select **Roles** and search for the specific role generated for this application scan.
3. Select the role and click **Delete**.
4. Confirm deletion to remove all cross-account trust boundaries and ensure zero lingering configurations.

---
*Live Project Demo Available At:* [FinOps-Bharat Environment](http://finops-bharat-env.eba-6yvcbyqr.ap-south-1.elasticbeanstalk.com/)
