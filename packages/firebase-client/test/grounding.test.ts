import { describe, expect, it, vi } from "vitest";
import { EN_COPY } from "@toulmin/copy";
import {
  GROUNDING_IFRAME_SANDBOX,
  createGroundingIframe,
  formatCloudReloadLabelFromTimestamp,
  isSafeHttpsUri,
  isThisPaperGroundingUri,
  renderGroundingSourcesList,
  type DomElementLike,
} from "../src/index.js";

interface FakeDomElement extends DomElementLike {
  readonly tagName: string;
  readonly attributes: Record<string, string>;
  readonly children: FakeDomElement[];
  src?: string;
  sandbox?: string;
}

function makeFakeDomFactory() {
  const created: FakeDomElement[] = [];
  const createElement = (tagName: string): FakeDomElement => {
    const attributes: Record<string, string> = {};
    const children: FakeDomElement[] = [];
    const el: FakeDomElement = {
      tagName,
      attributes,
      children,
      textContent: null,
      setAttribute(name: string, value: string) {
        attributes[name] = value;
      },
      appendChild(child: DomElementLike) {
        children.push(child as FakeDomElement);
        return child;
      },
    };
    created.push(el);
    return el;
  };
  return { createElement, created };
}

describe("Web grounding Blob-URL iframe & DOM sources renderer (AC-GND-02)", () => {
  it("renders unmodified renderedContent in Blob-URL iframe without srcdoc and revokes Blob URL on dispose", async () => {
    const { createElement } = makeFakeDomFactory();
    const capturedBlobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlobs.push(blob);
      return "blob:https://toulmin.web.app/mock-grounding-1";
    });
    const revokeObjectURL = vi.fn();

    const rawSnippet = '<style>.g{color:red}</style><div class="g">Search Suggestions</div>';
    const handle = createGroundingIframe(rawSnippet, {
      createElement,
      createObjectURL,
      revokeObjectURL,
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(capturedBlobs[0]!.type).toBe("text/html");
    expect(await capturedBlobs[0]!.text()).toBe(rawSnippet);

    const iframe = handle.iframe as unknown as FakeDomElement;
    expect(iframe.src).toBe("blob:https://toulmin.web.app/mock-grounding-1");
    expect(iframe.attributes["sandbox"]).toBe(GROUNDING_IFRAME_SANDBOX);
    expect(iframe.attributes["sandbox"]).not.toContain("allow-scripts");
    expect(iframe.attributes["sandbox"]).not.toContain("allow-same-origin");
    expect(iframe.attributes["srcdoc"]).toBeUndefined();
    expect((iframe as unknown as Record<string, unknown>)["srcdoc"]).toBeUndefined();

    handle.dispose();
    handle.dispose(); // idempotent
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://toulmin.web.app/mock-grounding-1");
  });

  it("enforces https:-only URIs, DOI path-segment matching, and plain DOM rendering", () => {
    expect(isSafeHttpsUri("https://doi.org/10.1234/abc")).toBe(true);
    expect(isSafeHttpsUri("http://doi.org/10.1234/abc")).toBe(false);
    expect(isSafeHttpsUri("javascript:alert(1)")).toBe(false);

    expect(isThisPaperGroundingUri("https://doi.org/10.1234/ABC", "10.1234/abc")).toBe(true);
    expect(isThisPaperGroundingUri("https://pub.org/doi/full/10.1234/abc", "10.1234/abc")).toBe(true);
    expect(isThisPaperGroundingUri("https://pub.org/doi/10.1234%2Fabc", "10.1234/abc")).toBe(true);
    expect(isThisPaperGroundingUri("https://pub.org/doi/10.1234/abcdef", "10.1234/abc")).toBe(false);
    expect(isThisPaperGroundingUri("https://pub.org/search?q=10.1234/abc", "10.1234/abc")).toBe(false);
    expect(
      isThisPaperGroundingUri("https://journal.example.org/article/99", "10.1234/abc", "journal.example.org")
    ).toBe(true);

    const { createElement } = makeFakeDomFactory();
    const list = renderGroundingSourcesList(
      [
        { web: { uri: "https://doi.org/10.1234/abc", title: "Original Paper" } },
        { web: { uri: "https://other.example.org/post", title: "10.1234/abc in title only" } },
        { web: { uri: "javascript:alert(1)", title: "XSS" } },
        { web: { uri: "http://insecure.example.org", title: "HTTP" } },
      ],
      { refDoi: "10.1234/abc" },
      { createElement }
    ) as FakeDomElement;

    expect(list.children).toHaveLength(2);
    expect(list.children[0]!.children).toHaveLength(2); // <a> + "This paper" <span>
    expect(list.children[0]!.children[0]!.attributes["href"]).toBe("https://doi.org/10.1234/abc");
    expect(list.children[0]!.children[0]!.attributes["target"]).toBe("_blank");
    expect(list.children[0]!.children[0]!.attributes["rel"]).toBe("noopener noreferrer");
    expect(list.children[0]!.children[1]!.textContent).toBe(EN_COPY.cloud.thisPaperBadge);
    expect(list.children[1]!.children).toHaveLength(1); // DOI in title does not earn badge
  });

  it("formats reload label cleanly", () => {
    const label = formatCloudReloadLabelFromTimestamp(1700000000000, "en-US");
    expect(label).toContain("Checked in the cloud on");
    expect(label).toContain("re-run to see sources");
  });
});
