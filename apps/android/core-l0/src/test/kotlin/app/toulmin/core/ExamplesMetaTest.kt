package app.toulmin.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Ports all §2–§6 normative worked examples from `packages/core-l0/test/examples.meta.test.ts`
 * (`AC-L0-24`, `AC-L0-25`).
 */
class ExamplesMetaTest {
    @Test
    fun `section 2 normalization, foldLatin, U+0130, zero-width preservation-deletion, and Lancet middle dot`() {
        assertEquals("M\u00FCller", norm("Mu\u0308ller").text)
        assertEquals("Muller", foldLatin("M\u00FCller"))
        assertEquals("\u0130", normLower("\u0130"))
        assertEquals("mortality", norm("mor\u200btality").text)
        assertEquals("\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645", norm("\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645").text)
        assertEquals("\uD83D\uDC69\u200D\uD83D\uDD2C", norm("\uD83D\uDC69\u200D\uD83D\uDD2C").text)
        assertEquals("0.45", norm("0\u00B745").text)
        assertEquals("1.2\u00D710^-3", norm("1.2\u00B710\u207B\u00B3").text)
    }

    @Test
    fun `section 3 pre-masking, mathText, LaTeX substitutions, and section hierarchy`() {
        assertEquals("p < 0.05", mathText("p < 0.05"))
        assertEquals("(a)/(b) + sqrt(x)", mathText("\\frac{a}{b} + \\sqrt{x}"))

        val latex = applyLatexSubstitutions("\\ce{CO2}, \\gls{CI}, \\cellcolor{gray}{12}, \\newline end")
        assertEquals("CO2, CI, 12,  end", latex.text)
        assertEquals(listOf("gls", "cellcolor", "newline"), latex.unregisteredCommands)

        val mdCurrency = preMask("Cost was \$5 per dose and \$10 per visit.", SourceFormat.MD)
        assertEquals(0, mdCurrency.mathRegions.size)
        assertEquals("Cost was \$5 per dose and \$10 per visit.", mdCurrency.maskedText)

        val texPre = preMask(
            "\\section{Methods}\nSample size \$p<0.05\$.\n\\subsection{Cohort and follow-up}\nOutcomes \$p<0.01\$.",
            SourceFormat.LATEX,
        )
        assertEquals(listOf("p<0.05", "p<0.01"), texPre.mathRegions.map { it.text })
        assertEquals(
            SectionState(CanonicalSectionLabel.METHODS, "Cohort and follow-up"),
            texPre.sectionTransitions.last().state,
        )

        val tracker = SectionTracker()
        tracker.pushHeading(3, "Methods")
        tracker.pushHeading(4, "Cohort and follow-up")
        assertEquals(SectionState(CanonicalSectionLabel.METHODS, "Cohort and follow-up"), tracker.current)

        assertEquals(
            "drug x reduced pain \u27E6c\u27E7 by 30%.",
            normSentence(
                "Drug X reduced pain [1] by 30%.",
                NormSentenceOptions(format = SourceFormat.MD, markerRanges = listOf(TextRange(20, 23))),
            ),
        )
    }

    @Test
    fun `section 4 segmentation normative biomedical and punctuation examples`() {
        val doc = listOf(
            "Mice were injected i.p. Animals were monitored after a 0.5 mg i.p. injection in group B. The protocol matched vitamin C. Controls remained stable while J. Smith recorded measurements.",
            "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 reached 3.5. X showed no effect. [12] The steps follow: 1) Mix reagents. 2) Incubate in sec. results or sec. Methods.",
        ).joinToString(" ")
        val seg = segmentDocument(doc, SourceFormat.MD)
        assertEquals(
            listOf(
                "Mice were injected i.p.",
                "Animals were monitored after a 0.5 mg i.p. injection in group B.",
                "The protocol matched vitamin C.",
                "Controls remained stable while J. Smith recorded measurements.",
                "Pathways p53, mRNA, siRNA, iPSC, pH, t1, t-test, p-value, and n-3 reached 3.5.",
                "X showed no effect. [12]",
                "The steps follow: 1) Mix reagents. 2) Incubate in sec. results or sec.",
                "Methods.",
            ),
            seg.sentences.map { it.rawText },
        )
    }

    @Test
    fun `section 5 citation scanner Rule 2 normative table, Author-Year, organization rule, NON_NAME_WORDS, and email check`() {
        val rule2Table = listOf(
            "reduced mortality by 30% [1]" to listOf(1),
            "reduced mortality by 30% [1, 2]." to listOf(1, 2),
            "as listed in Table 2 [3, 7]." to listOf(3, 7),
            "reported in 2019 [3]" to listOf(3),
            "in social [3] contexts" to listOf(3),
            "across species [14]" to listOf(14),
            "95% CI [12, 45]" to emptyList(),
            "IQR [3, 7]" to emptyList(),
        )
        for ((text, expected) in rule2Table) {
            val m = scanCitations(text)
            assertEquals(expected, m.flatMap { it.numericIds }, text)
        }

        val ay = scanCitations(
            "(Smith et al., 2020a) alongside (March 2020) and (Table 2020) and name@example.org.",
        )
        assertEquals(1, ay.size)
        assertEquals(CitationRuleKind.AUTHOR_YEAR_PAREN, ay[0].rule)
        assertEquals("Smith", ay[0].authorYears[0].surname)
        assertEquals("2020a", ay[0].authorYears[0].year)

        assertEquals("WHO", extractCorporateInitials("{{World Health Organization}}"))
        val whoResolved = resolveCitationMarkers(
            scanCitations("WHO (2020) reported reductions."),
            ResolveCitationsOptions(
                entries = listOf(
                    BibliographyEntry(
                        refId = "who_ref",
                        key = "who2020",
                        corporateAuthor = "{{World Health Organization}}",
                        year = "2020",
                    ),
                ),
            ),
        )
        assertEquals(1, whoResolved.resolvedMarkers.size)
        assertEquals(MarkerResolutionStatus.RESOLVED, whoResolved.resolvedMarkers[0].status)
        assertEquals(listOf("who_ref"), whoResolved.resolvedRefIds)
    }

    @Test
    fun `section 6 ALL 15 normative clause examples with stated intermediate trace and word counts`() {
        val ex1 = partitionClausesWithTrace(
            "Drug X reduced mortality by 30% [1] but increased bleeding [2].",
            scanCitations("Drug X reduced mortality by 30% [1] but increased bleeding [2]."),
        )
        assertEquals(listOf("Drug X reduced mortality by 30%", "increased bleeding"), ex1.clauses.map { it.claimText })

        val ex2 = partitionClausesWithTrace(
            "Smith et al. (2020) found no effect of X on Y.",
            scanCitations("Smith et al. (2020) found no effect of X on Y."),
        )
        assertEquals(listOf("found no effect of X on Y"), ex2.clauses.map { it.claimText })
        assertTrue(ex2.groups[0].narrative)

        val ex3 = partitionClausesWithTrace(
            "X improves Y \\cite{a,b}.",
            scanCitations("X improves Y \\cite{a,b}."),
        )
        assertEquals("X improves Y", ex3.clauses[0].claimText)
        assertEquals(listOf("a", "b"), ex3.clauses[0].markers[0].keys)

        val ex4 = partitionClausesWithTrace(
            "As shown previously [3], X improves Y.",
            scanCitations("As shown previously [3], X improves Y."),
        )
        assertEquals(listOf("X improves Y"), ex4.clauses.map { it.claimText })

        val ex5 = partitionClausesWithTrace(
            "Smith et al. (2020) found X reduces Y [3].",
            scanCitations("Smith et al. (2020) found X reduces Y [3]."),
        )
        assertEquals(1, ex5.clauses.size)
        assertEquals("found X reduces Y", ex5.clauses[0].claimText)
        assertEquals(listOf("Smith et al. (2020)", "[3]"), ex5.clauses[0].markers.map { it.rawText })

        val ex6 = partitionClausesWithTrace(
            "Drug X, as shown by Smith (2020), reduced Y.",
            scanCitations("Drug X, as shown by Smith (2020), reduced Y."),
        )
        assertEquals("Drug X reduced Y", ex6.clauses[0].claimText)

        val ex7 = partitionClausesWithTrace(
            "Smith (2020) found X [3], but Jones (2021) found not-X.",
            scanCitations("Smith (2020) found X [3], but Jones (2021) found not-X."),
        )
        assertEquals(listOf("found X", "found not-X"), ex7.clauses.map { it.claimText })

        val s8 = "X increased A [1] and decreased B in older adults [2]."
        val ex8 = partitionClausesWithTrace(s8, scanCitations(s8))
        assertEquals(1, ex8.splitTraces.size)
        assertEquals(6, ex8.splitTraces[0].betweenWordCount)
        assertTrue(ex8.splitTraces[0].didSplit)
        assertEquals(listOf("X increased A", "decreased B in older adults"), ex8.clauses.map { it.claimText })

        val ex9 = partitionClausesWithTrace(
            "The effect was large [4], which was unexpected.",
            scanCitations("The effect was large [4], which was unexpected."),
        )
        assertEquals(listOf("The effect was large, which was unexpected"), ex9.clauses.map { it.claimText })

        val s10 = "Prior work [@k0; @k1; @k2"
        val ex10 = partitionClausesWithTrace(s10, scanCitations(s10))
        assertEquals(0, ex10.groups.size)
        assertTrue(ex10.clauses[0].uncited)
        assertEquals(s10, ex10.clauses[0].claimText)

        val s11 = "The effect was large [4], which was unexpected, and the control was small [5]."
        val ex11 = partitionClausesWithTrace(s11, scanCitations(s11))
        assertEquals(1, ex11.splitTraces.size)
        assertEquals(8, ex11.splitTraces[0].betweenWordCount)
        assertEquals("which", ex11.splitTraces[0].relativizerMatched)
        assertTrue(ex11.splitTraces[0].didSplit)
        val splitOffset = ex11.splitTraces[0].splitOffset
        assertNotNull(splitOffset)
        assertTrue(s11.substring(splitOffset!!).startsWith(", and the control"))
        assertEquals(
            listOf("The effect was large, which was unexpected", "the control was small"),
            ex11.clauses.map { it.claimText },
        )

        val s12 = "X not only reduced pain but also improved sleep [6]."
        val ex12 = partitionClausesWithTrace(s12, scanCitations(s12))
        assertEquals(1, ex12.clauses.size)
        assertEquals("X not only reduced pain but also improved sleep", ex12.clauses[0].claimText)

        val s13 = "Mortality fell by 30% [1] in 2019 [2]."
        val ex13 = partitionClausesWithTrace(s13, scanCitations(s13))
        assertEquals(1, ex13.splitTraces.size)
        assertEquals(2, ex13.splitTraces[0].betweenWordCount)
        assertEquals(false, ex13.splitTraces[0].didSplit)
        assertEquals(listOf("Mortality fell by 30% in 2019"), ex13.clauses.map { it.claimText })

        val s14 = "X improves Y [3] , and Z [4]."
        val ex14 = partitionClausesWithTrace(s14, scanCitations(s14))
        assertEquals(1, ex14.splitTraces.size)
        assertEquals(2, ex14.splitTraces[0].betweenWordCount)
        assertEquals(false, ex14.splitTraces[0].didSplit)
        assertEquals(listOf("X improves Y, and Z"), ex14.clauses.map { it.claimText })

        val s15 = "However, [2] reported that X reduces Y."
        val ex15 = partitionClausesWithTrace(s15, scanCitations(s15))
        assertEquals(listOf("reported that X reduces Y"), ex15.clauses.map { it.claimText })
    }
}
