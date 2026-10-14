# Template provenance

Backend snapshot: f6867816592fcb55972d846e9a4fa80764c367d6, built and privately deployed on 2026-10-14.

Portable adaptations remove the publisher project ID and publisher-specific origin, use the request origin plus ChatGPT origin, replace a smoke-test hostname with fixture.invalid, omit generated tsbuildinfo, and reduce local download bridge chunks to 32 KiB. Platform identity/authentication, TLS checks, account isolation, task/revision/receipt validation and byte limits remain in place. D1=DB and R2=BUCKET are provisioned in each user's own private Site.

This is source for first initialization, with a locked dependency file. It contains no account connection, credentials or test materials. The package manifest checks content integrity; it is not a publisher signature or proof that a friend's platform account supports the necessary features.
