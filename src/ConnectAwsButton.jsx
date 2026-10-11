import { useState } from 'react';
import { Cloud, X } from 'lucide-react';

export default function ConnectAwsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [roleArnInput, setRoleArnInput] = useState(localStorage.getItem('finops_role_arn') || '');
  const [savedRoleArn, setSavedRoleArn] = useState(localStorage.getItem('finops_role_arn') || '');

  const handleSave = () => {
    const clean = roleArnInput.trim();
    if (!clean) return;
    localStorage.setItem('finops_role_arn', clean);
    setSavedRoleArn(clean);
    setIsOpen(false);
    window.location.reload(); // Refreshes dashboard with new AWS cross-account data
  };

  const handleDisconnect = () => {
    localStorage.removeItem('finops_role_arn');
    setSavedRoleArn('');
    setRoleArnInput('');
    setIsOpen(false);
    window.location.reload();
  };

  return (
    <>
      <button className="connect-button" onClick={() => setIsOpen(true)}>
        <Cloud size={16} /> {savedRoleArn ? 'AWS Connected' : 'Connect AWS'}
      </button>

      {isOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if ([suspicious link removed] === e.currentTarget) setIsOpen(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true">
            <button className="modal-close" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>

            <span className="eyebrow">AWS CROSS-ACCOUNT IAM SETUP</span>
            <h2>Connect Your AWS Account</h2>
            <p className="text-xs text-gray-300 mb-4">
              Deploy our read-only CloudFormation stack in your AWS console to create a secure role.
            </p>

            <a
              href="/cloudformation.yaml"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full text-center bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2.5 px-4 rounded-lg mb-4 text-xs block transition"
            >
              🚀 Deploy 1-Click CloudFormation Stack
            </a>

            <label className="block text-xs font-semibold text-gray-400 uppercase mb-1">
              Paste Generated Role ARN:
            </label>
            <input
              type="text"
              placeholder="arn:aws:iam::123456789012:role/FinOpsBharatReadOnlyRole"
              value={roleArnInput}
              onChange={(e) => setRoleArnInput([suspicious link removed].value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2.5 text-xs mb-4 text-white focus:outline-none focus:border-blue-500"
            />

            <div className="flex justify-between items-center">
              {savedRoleArn ? (
                <button onClick={handleDisconnect} className="text-xs text-red-400 hover:text-red-300">
                  Disconnect Account
                </button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <button onClick={() => setIsOpen(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs text-white font-medium rounded-lg">
                  Save & Connect
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
