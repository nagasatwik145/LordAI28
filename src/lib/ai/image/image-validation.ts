// Pre-request validation for the Cloudflare image pipeline (spec §5, §6).
//
// These checks run BEFORE any network call so misconfiguration fails fast with a
// clear, structured error instead of a confusing Cloudflare 4xx/5xx.

import { ImageGenerationError } from "./image-errors";
import { readEnvApiKey } from "../../env.server";
import { DEFAULT_IMAGE_MODEL_ID, isRegisteredImageModel } from "./image-models";

const ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";
const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const MODEL_ENV = "CLOUDFLARE_IMAGE_MODEL";

/**
 * Phase 5: verify CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are present.
 *
 * @returns an {@link ImageGenerationError} (MISSING_CREDENTIALS, not recoverable)
 *   when configuration is incomplete, otherwise `null`.
 */
export function getImageEnvironmentError(): ImageGenerationError | null {
  const missing: string[] = [];
  if (!readEnvApiKey(ACCOUNT_ENV)) missing.push(ACCOUNT_ENV);
  if (!readEnvApiKey(TOKEN_ENV)) missing.push(TOKEN_ENV);
  if (missing.length === 0) return null;
  return new ImageGenerationError("MISSING_CREDENTIALS", "Cloudflare configuration missing.", {
    status: 503,
    recoverable: false,
    hint: `Set ${missing.join(", ")} on the server.`,
  });
}

/**
 * Phase 6: reject an explicitly configured but unknown model id.
 *
 * A value exactly matching the documented expectation (`@cf/...`) is required;
 * anything not present in the registry is rejected rather than silently falling
 * back, because its request contract is unknown and would 400 on the user.
 */
export function getConfiguredModelError(): ImageGenerationError | null {
  const configured = process.env[MODEL_ENV]?.trim();
  if (!configured) return null;
  if (isRegisteredImageModel(configured)) return null;
  return new ImageGenerationError(
    "INVALID_MODEL",
    `Configured model does not exist. Expected: ${DEFAULT_IMAGE_MODEL_ID} Received: ${configured}`,
    {
      status: 400,
      recoverable: false,
      model: configured,
      hint: `Set ${MODEL_ENV} to a registered @cf/... model.`,
    },
  );
}
