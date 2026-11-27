/**
 * Entry module for `/apps/web/spike.html` (`07` §1.1 rule 6).
 * Excluded from production Hosting deploys.
 */

import { bindDomPurifyHtmlSanitizer } from "./security/trustedTypes.js";
import { mountSpikeHarnessUi } from "./spikes/ui.js";

bindDomPurifyHtmlSanitizer();

const root = document.getElementById("spike-root");
if (root) {
  mountSpikeHarnessUi(root);
}
