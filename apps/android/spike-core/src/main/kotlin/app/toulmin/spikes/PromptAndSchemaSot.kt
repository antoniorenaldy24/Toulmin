package app.toulmin.spikes

import app.toulmin.core.MetadataFieldName
import app.toulmin.core.norm
import app.toulmin.core.sanitizeMetadataField
import app.toulmin.core.sanitizeText
import app.toulmin.core.sha256hexBytes
import app.toulmin.core.wrapEvidenceBlock

class PromptHashMismatchException(message: String) : IllegalStateException(message)

object PromptAndSchemaSot {
    const val PROMPT_VERSION = "p2.1"

    val PROMPT_FILES = listOf(
        "stage1.txt",
        "stage2.txt",
        "b5.txt",
        "o2.txt",
        "alt_sources.txt",
    )

    val SCHEMA_KEYS: Map<String, List<String>> = mapOf(
        "TriageV1" to listOf("s1_atoms", "s2_worth", "s3_uncited", "s4_bib"),
        "TriageFlatV1" to listOf("s1_start", "s2_end", "s3_type", "s4_worth", "s5_uncited"),
        "VerdictV1" to listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
        "VerdictV1_cap30" to listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
        "VerdictV1_cap20" to listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
        "VerdictFlatV1" to listOf("s01_evidence_span", "s02_evidence_idx", "s03_micro_reasoning", "s04_verdict"),
        "B5CheckV1" to listOf("s1_what", "s2_same_population", "s3_verdict"),
        "O2PhysicalExtractV1" to listOf("s1_kind", "s2_facts", "s3_doi"),
        "O2PhysicalExtractFlatV1" to listOf("s1_kind", "s2_quote", "s3_column", "s4_value", "s5_doi"),
        "AltSourcesV1" to listOf("s1_library_idx", "s2_dois"),
    )

    val PRIMARY_ON_DEVICE_SCHEMAS = listOf(
        "TriageV1",
        "VerdictV1",
        "VerdictV1_cap30",
        "B5CheckV1",
        "O2PhysicalExtractV1",
    )

    val FLAT_FALLBACK_SCHEMAS = mapOf(
        "TriageV1" to "TriageFlatV1",
        "VerdictV1" to "VerdictFlatV1",
        "VerdictV1_cap30" to "VerdictFlatV1",
        "O2PhysicalExtractV1" to "O2PhysicalExtractFlatV1",
    )

    fun verifyPromptHash(fileName: String, contentBytes: ByteArray, expectedSha256: String) {
        val actual = sha256hexBytes(contentBytes)
        if (actual != expectedSha256) {
            throw PromptHashMismatchException(
                "PROMPT_HASH_MISMATCH for $fileName: expected $expectedSha256, got $actual",
            )
        }
    }

    fun formatNumberedWords(sentence: String, maxWords: Int = 80): String {
        val words = norm(sentence).text.split(' ').filter { it.isNotEmpty() }.take(maxWords)
        return words.mapIndexed { index, w -> "$index:$w" }.joinToString(" ")
    }

    /**
     * Matches `packages/prompts/src/builders.ts` `buildStage1Prompt` (`04` §3.2):
     * keeps `PREVIOUS_SENTENCE: """"""` when empty, and emits `(none)` under
     * `CANDIDATE_REFERENCES` when no candidates are provided.
     */
    fun assembleStage1Prompt(
        template: String,
        hasCitation: Boolean,
        previousSentence: String?,
        sentence: String,
        candidateReferences: List<Pair<String, String>> = emptyList(),
    ): String {
        val numberedWords = formatNumberedWords(sentence)
        val candidates = candidateReferences.take(5)
        val lines = template.split('\n')
        val out = ArrayList<String>(lines.size)
        var emittedNone = false
        for (line in lines) {
            when {
                line.startsWith("[") && line.contains("{title_") -> {
                    if (candidates.isEmpty()) {
                        if (!emittedNone) {
                            out.add("(none)")
                            emittedNone = true
                        }
                        continue
                    }
                    val idx = line.substringAfter('[').substringBefore(']').toIntOrNull()
                    if (idx == null || idx !in candidates.indices) continue
                    val (rawTitle, year) = candidates[idx]
                    val safeTitle = sanitizeMetadataField(MetadataFieldName.TITLE, rawTitle).value
                    out.add("[$idx] $safeTitle ($year)")
                }
                else -> {
                    out.add(
                        line
                            .replace("{has_citation}", hasCitation.toString())
                            .replace("{previous_sentence}", previousSentence.orEmpty())
                            .replace("{sentence}", sentence)
                            .replace("{words_numbered}", numberedWords),
                    )
                }
            }
        }
        return out.joinToString("\n")
    }

    /**
     * Matches `packages/prompts/src/builders.ts` `buildStage2Prompt` (`02` §9.3/§9.5, `04` §3.1):
     * blocked units are excluded completely before compact 0-based `<<EVIDENCE id=n>>` wrapping.
     */
    fun assembleStage2Prompt(
        template: String,
        contextSentence: String,
        clauseText: String,
        evidenceBlocks: List<String>,
        wordCap: Int = 40,
    ): String {
        val wrappedKept = ArrayList<String>(5)
        for (raw in evidenceBlocks.take(5)) {
            val sanitized = sanitizeText(raw)
            if (sanitized.blocked) continue
            wrappedKept.add(wrapEvidenceBlock(wrappedKept.size, sanitized.text))
        }

        val headerLines = template.substringBefore("\nEVIDENCE:")
            .replace("{word_cap}", wordCap.toString())
            .replace("{context_sentence}", contextSentence)
            .replace("{clause_text}", clauseText)

        return buildString {
            append(headerLines)
            append("\nEVIDENCE:")
            for (block in wrappedKept) {
                append('\n')
                append(block)
            }
        }
    }

    fun assembleB5Prompt(
        template: String,
        sectionA: String,
        valueA: String,
        unitA: String,
        windowA: String,
        sectionB: String,
        valueB: String,
        unitB: String,
        windowB: String,
    ): String =
        template
            .replace("{section_a}", sectionA)
            .replace("{value_a}", valueA)
            .replace("{unit_a}", unitA)
            .replace("{window_a}", windowA)
            .replace("{section_b}", sectionB)
            .replace("{value_b}", valueB)
            .replace("{unit_b}", unitB)
            .replace("{window_b}", windowB)

    /**
     * Matches `packages/prompts/src/builders.ts` `buildO2Prompt` (`02` §9.5, `04` §3.1):
     * omits blocked OCR blocks together with their `HEADER` / `ROW` headings and delimiters.
     */
    fun assembleO2Prompt(
        template: String,
        claimText: String,
        headerText: String,
        rowText: String,
    ): String {
        val headerSanitized = sanitizeText(headerText)
        val rowSanitized = sanitizeText(rowText)
        val prefix = template.substringBefore("\nHEADER (cells separated by \" | \"):")
            .replace("{claim_text}", claimText)

        return buildString {
            append(prefix)
            if (!headerSanitized.blocked) {
                append("\nHEADER (cells separated by \" | \"):\n")
                append(wrapEvidenceBlock(0, headerSanitized.text))
            }
            if (!rowSanitized.blocked) {
                append("\nROW (cells separated by \" | \"):\n")
                append(wrapEvidenceBlock(1, rowSanitized.text))
            }
        }
    }
}
