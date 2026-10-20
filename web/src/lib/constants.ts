// TAB_SPACE_WIDTH is the default tab space width.
export const TAB_SPACE_WIDTH = 2;

// DEFAULT_LIST_MEMOS_PAGE_SIZE is the default page size for list memos request.
export const DEFAULT_LIST_MEMOS_PAGE_SIZE = 16;

// LOADING_INDICATOR_DELAY_MS is how long a load must take before the loading spinner appears.
// Loads that finish faster than this never render the spinner, avoiding a flash on fast/self-hosted networks.
export const LOADING_INDICATOR_DELAY_MS = 250;

export const DEFAULT_APP_TITLE = "Noter.ai";

// Older installations may still store the upstream default as their title.
export const getInstanceTitle = (title?: string) => (!title?.trim() || /^memos?$/i.test(title.trim()) ? DEFAULT_APP_TITLE : title);

export const MEMOS_WEBSITE_URL = "https://github.com/mrfost07/noter.ai";
export const MEMOS_DOCUMENTATION_URL = "https://github.com/mrfost07/noter.ai/blob/main/README.md";
export const MEMOS_API_DOCUMENTATION_URL = "https://github.com/mrfost07/noter.ai/tree/main/proto/api";
export const MEMOS_GITHUB_URL = "https://github.com/mrfost07/noter.ai";

// Upstream Memos browser extension.
export const WEB_CLIPPER_URL = "https://github.com/usememos/web-clipper";
