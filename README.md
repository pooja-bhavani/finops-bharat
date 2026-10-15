# FinOps-Bharat 🇮🇳

**FinOps-Bharat** is an open-source cloud financial management and cost optimization platform tailored for enterprises and cloud architectures. It allows organizations to gain real-time visibility into their AWS infrastructure, optimize spending, and implement cloud governance frameworks efficiently. 

<img width="1470" height="838" alt="Screenshot 2026-10-15 at 3 26 28 pm" src="https://github.com/user-attachments/assets/0b91b51b-c2e3-4b4d-ae2e-d5fd5af701f6" />

Why this matters
India's digital public services and growing startup ecosystem depend on reliable cloud infrastructure. Unused disks, idle addresses, forgotten snapshots, and oversized environments can consume public and private budgets while also using energy. Those costs can limit money available for service delivery, innovation, connectivity, and digital skills.

FinOps-Bharat surfaces observed account data for teams to review. An unattached resource is not proof that it is safe to delete, and Cost Explorer totals are not per-resource savings estimates.

---

## Architecture Overview

FinOps-Bharat is organized into clear, intuitive sections designed to give full visibility into your cloud footprint without overwhelming engineers:

**What It Does & Why It's Useful**

| Section / Component | What It Does & Key Features |
| :--- | :--- |
| **1. Executive Overview Dashboard** | Displays monthly spend trends, total waste recovery potential in **₹ (INR)**, avoided carbon footprint metrics, and a 6-month historical spend trajectory chart. Breaks down cost allocation across Compute, Storage, Database, and Networking categories so you know where your money goes. |
| **2. Resource Inventory Audit** | **Deep-Dive Audit:** Scans and lists unattached EBS volumes, unassociated Elastic IPs, stale EBS snapshots, and low-utilization EC2 instances. Each resource includes age tracking (e.g., *unattached for 42 days*), risk notes, and a 1-click **CSV Export** button for team reporting. |
| **3. Learn FinOps & Terminal Labs** | **Hands-On Training:** Includes structured educational guides on cloud bill analysis and policy enforcement, paired with an embedded **TWS Terminal Labs** sandbox. Developers can execute live AWS CLI audit and cleanup queries inside disposable, machine-graded container environments. |
| **4. AWS Cross-Account Scanner** | **Stateless AWS Connection:** Modal interface allowing users to connect their AWS account via 1-Click CloudFormation deployment. The backend uses temporary AWS STS credentials (`AssumeRole`) to perform read-only scans without storing secret keys. |
| **5. FastAPI & Boto3 Backend** | **Real-Time Scan Engine:** High-performance Python backend (`backend/main.py`) executing live AWS API queries via Boto3. Filters available volumes, unassigned IPs, and EC2 instances in real time. |

---

## Getting Started (End-to-End Test Guide)

Follow these step-by-step instructions to clone, configure, and launch the entire application locally for testing purposes.

### Prerequisites
Before running the application, ensure you have the following installed on your machine:
* **Git**
* **Node.js (v18+) & npm**
* **Python (v3.10+) & pip** 
* **AWS CLI** (configured with read-only permissions for testing)

### Step 1: Clone the Repository
Open your terminal and execute the following command to clone the project:
```bash
git clone https://github.com/your-username/finops-bharat.git
cd finops-bharat
```

Step 2: Environment Configuration
Create a .env file in the root directory and add your required configuration details:

```bash
cp .env.example .env

# Edit the .env file with your local configuration parameters
```

Step 3: Install Dependencies
Install all the required application packages:

```bash
# For Python-based backends
pip install -r requirements.txt

# For Node.js-based frontends/backends
npm install
```

# Create & activate Python virtual environment for Backend

```bash
python3 -m venv venv
source venv/bin/activate

# Install Backend dependencies
pip install fastapi uvicorn boto3
```

### Step 2: Start FastAPI Backend

```bash
uvicorn backend.main:app --reload --port 8000
```

### Step 4: Run the Application
Launch the local development server to run the application end-to-end:

```bash
Start Vite React Frontend
npm run dev
```

Visit http://localhost:5173 in your browser to view the app!

### 4. End-to-End Automated Deployment on AWS Elastic Beanstalk

FinOps-Bharat is pre-configured with GitHub Actions (.github/workflows/deploy.yml) for automated deployments:

* Create an Elastic Beanstalk Environment in AWS (ap-south-1 / Mumbai):
* Application Name: finops-bharat
* Environment Name: FinOps-bharat-env
* Platform: Python 3.11 or Docker
* Configure GitHub Repository Secrets: Go to GitHub Repo -> Settings -> Secrets and variables -> Actions and add:
* AWS_ACCESS_KEY_ID: Your AWS deployment key ID
* AWS_SECRET_ACCESS_KEY: Your AWS secret key
* AWS_REGION: ap-south-1

**Trigger Deployment: Push any update to the main branch:**
```
git add .
git commit -m "feat: deploy finops-bharat to elastic beanstalk"
git push origin main
```
GitHub Actions will automatically test, package, and deploy your code to Elastic Beanstalk in under 2 minutes!

---

## Secure User Access & Account Scanning (Tester Guide)

**Connect & Scan Your AWS Account**

FinOps-Bharat is engineered with security and data privacy at its core. Enterprise-grade monitoring does not require exposing sensitive long-term credentials.

### How to Get Your AWS Account Scanned

**Create the read-only role**

Open the live FinOps-Bharat URL in your browser.

1. Open the live FinOps-Bharat URL in your browser.

2. Click Connect AWS in the top bar.

3. Click Launch CloudFormation stack. This opens the AWS CloudFormation console in your own account with a read-only IAM role (FinOpsBharatReadOnly) prefilled. It includes a one-time External ID unique to your browser session. Don’t change it.

4. Leave Permissions empty, tick the IAM acknowledgement box at the bottom, and click Create stack.

5. Wait about a minute until the status shows CREATE_COMPLETE.

### Critical Security Note on Data Retention
> **Your data belongs to you.** Your AWS account scanning data is strictly visible to you in your active browser session **only once your current scan is completed**. Due to our stateless, security-first architecture, the moment you close the tab or refresh your browser page, **no data is retained or stored** by the application. You must re-initiate a secure session scan to view updated metrics.

### No Long-Term Credentials Required
To maintain an optimal security posture, **long-term credentials (like AWS Access Keys and Secret Keys) are strictly not required**. You can securely access and scan your cloud footprint solely via **AWS IAM Roles** or your **AWS Account ID**, ensuring your root or administrative environments remain fully isolated and protected.

---

## App Usage Guide

Once the application is up and running, end-users can leverage its core components via these steps:
1. **Access the Dashboard:** Open the application interface in your browser.
2. **Authenticate / Connect:** Head over to the *Cloud Integration* segment and provide your Role ARN or Account ID.
3. **Trigger Scan:** Click on **"Start Cloud Audit"** to let the backend scan your active resource configurations, idle resources, and underutilized nodes.
4. **Analyze Savings Opportunities:** Review detailed visual breakdowns highlighting immediate cost-saving vectors, such as unattached EBS volumes, idle EC2 instances, and localized pricing tiers optimized for Indian regions.

---

## Application Deletion Guide (Cost & Resource Cleanup)

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

> **Note on the demo link:** The live demo is served over plain http:// for now (HTTPS isn’t set up yet). Some browsers open the address as https:// by default, which shows an error such as “This site can’t be reached” (ERR_CONNECTION_TIMED_OUT). If that happens, type or paste the full address including http://:
