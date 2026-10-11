const originalFetch = window.fetch;

window.fetch = async function (resource, config = {}) {
  const roleArn = localStorage.getItem('finops_role_arn');
  if (roleArn) {
    config.headers = {
      ...(config.headers || {}),
      'x-aws-role-arn': roleArn,
    };
  }
  return originalFetch(resource, config);
};