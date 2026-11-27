package app.toulmin.spikes

object SpikeFixtures {
    /**
     * 10 synthetic 80-word scientific sentences (`07` §1.4 S-A3) for Stage 1 token ceiling checks.
     */
    val EIGHTY_WORD_SENTENCES: List<String> = listOf(
        "In a multicenter randomized double blind placebo controlled clinical trial conducted across fourteen academic hospitals we evaluated whether daily oral supplementation with standardized polyphenol extract over twenty four consecutive weeks significantly reduced serum C reactive protein concentrations compared with matched placebo tablets among adult participants diagnosed with stable coronary artery disease receiving guideline directed lipid lowering and antiplatelet therapy without adverse hepatic or renal laboratory abnormalities observed during scheduled monthly clinical safety visits throughout the entire follow up observation period.",
        "To determine whether longitudinal changes in cortical myelin water fraction correlate with processing speed recovery after mild traumatic brain injury we acquired multi echo gradient and spin echo magnetic resonance imaging scans from sixty eight adult patients within seventy two hours of emergency department presentation and repeated identical imaging protocols at ninety days while administering standardized computerized cognitive testing batteries under controlled lighting conditions inside quiet clinical examination suites at each participating outpatient regional neurology referral clinical center nationwide today.",
        "When primary murine cortical neurons were exposed to graded concentrations of extracellular glutamate for thirty minutes in serum free neurobasal medium containing physiological magnesium concentrations intracellular calcium fluorescence intensity increased rapidly within ninety seconds and remained significantly elevated above baseline throughout the subsequent four hour washout interval unless selective N methyl D aspartate receptor antagonists were co administered ten minutes prior to acute excitatory stimulation in parallel replicate culture wells across three independent primary embryonic cortical brain tissue preparations overnight.",
        "Although seasonal influenza vaccination coverage among outpatient healthcare personnel exceeded eighty four percent during the winter surveillance season hospital acquired respiratory viral transmission events declined markedly only in acute inpatient clinical wards where mandatory surgical mask wearing during direct bedside patient care was combined with automated electronic hand hygiene compliance monitoring and rapid point of care multiplex polymerase chain reaction diagnostic testing for all symptomatic staff members working across morning and overnight inpatient clinical hospital shifts every single calendar week.",
        "Across three independent prospective cohort studies comprising twelve thousand four hundred middle aged adults free of baseline atrial fibrillation higher habitual consumption of unsweetened filtered coffee up to three standard cups daily was not associated with increased incidence of supraventricular arrhythmias after comprehensive multivariable statistical adjustment for participant age sex body mass index systolic blood pressure cigarette smoking status alcohol intake thyroid hormone levels and regular weekly recreational physical activity recorded at each scheduled annual clinical outpatient follow up visit.",
        "Using high resolution cryo electron microscopy and single particle reconstruction at two point eight angstrom nominal resolution we resolved the closed and open conformational states of the bacterial membrane transporter complex reconstituted into lipid nanodiscs demonstrating that substrate binding within the central hydrophobic cavity triggers an outward rotation of transmembrane helices four and nine accompanied by rapid proton release from a conserved glutamate side chain positioned directly along the inner translocation channel lining the cytoplasmic outer lipid bilayer membrane leaflet.",
        "In contrast to conventional fixed dose antimicrobial prophylaxis regimens pharmacokinetic guided individualized vancomycin dosing targeting an area under the concentration time curve between four hundred and six hundred milligram hours per liter achieved therapeutic target attainment within twenty four hours in eighty nine percent of critically ill adult surgical patients while reducing acute kidney injury incidence by more than one third across matched clinical strata without delaying surgical wound healing or increasing secondary bloodstream infection rates during hospital inpatient stay.",
        "While satellite derived normalized difference vegetation index anomalies reliably captured severe summer drought stress across semi arid temperate grasslands during peak growing months ground based eddy covariance flux tower measurements revealed substantial temporal decoupling between canopy greenness and net ecosystem carbon uptake whenever early spring frost events damaged emerging foliage before maximum leaf area expansion occurred across all five monitored watershed sites during the multi year continental ecological observatory field drought experiment conducted continuously from early spring through late autumn.",
        "Because standard enzymatic creatinine assays remain susceptible to positive analytical interference from elevated serum bilirubin and cephalosporin antibiotics in neonates receiving intensive care we validated a liquid chromatography tandem mass spectrometry reference method using isotopically labeled internal standards over a broad linear calibration range spanning five to eight hundred micromoles per liter with intra assay imprecision below two point four percent and mean recovery exceeding ninety eight percent across all routine pediatric hospital inpatient clinical serum quality control concentration levels.",
        "By integrating single cell ribonucleic acid sequencing with spatial transcriptomics across paired primary tumors and synchronous hepatic metastases from twenty two patients with untreated colorectal adenocarcinoma we identified a distinct subpopulation of cancer associated fibroblasts expressing high levels of periostin and collagen eleven alpha one selectively concentrated along the invasive tumor margin where cytotoxic T lymphocyte infiltration was consistently depleted and extracellular matrix remodeling gene signatures strongly predicted significantly shorter recurrence free survival across two independent clinical validation patient cohorts.",
    )

    val SHORT_STAGE1_SENTENCES: List<String> = listOf(
        "Daily metformin therapy reduced hemoglobin A1c by 1.2% at 24 weeks.",
        "Overall 90-day survival was 84% in the treatment arm versus 71% in controls.",
        "The present manuscript aims to summarize recent advances in mitochondrial genetics.",
        "Samples were centrifuged at 3000 rpm for 10 minutes at 4 degrees Celsius.",
        "Systolic blood pressure fell by 11.4 mmHg after sodium restriction.",
    )

    fun stage1PromptSample(index: Int, template: String): String {
        val sentence = if (index < EIGHTY_WORD_SENTENCES.size) {
            EIGHTY_WORD_SENTENCES[index]
        } else {
            SHORT_STAGE1_SENTENCES[(index - EIGHTY_WORD_SENTENCES.size) % SHORT_STAGE1_SENTENCES.size]
        }
        return PromptAndSchemaSot.assembleStage1Prompt(
            template = template,
            hasCitation = (index % 2 == 0),
            previousSentence = "Baseline demographic characteristics were balanced between study groups.",
            sentence = sentence,
            candidateReferences = listOf(
                "Randomized trial of clinical outcome reductions" to "2024",
                "Mechanistic evaluation of biomarker endpoints" to "2023",
            ),
        )
    }

    fun stage2PromptSample(index: Int, template: String, wordCap: Int): String {
        val pairs = listOf(
            Triple(
                "In the randomized cohort, systolic blood pressure declined by 12 mmHg after treatment.",
                "systolic blood pressure declined by 12 mmHg after treatment",
                listOf(
                    "Across 140 treated patients, mean systolic blood pressure declined by 12 mmHg over 12 weeks compared with baseline.",
                    "Diastolic blood pressure remained stable throughout the outpatient monitoring period.",
                ),
            ),
            Triple(
                "Mortality at 28 days reached 37% in the intervention group.",
                "Mortality at 28 days reached 37% in the intervention group",
                listOf(
                    "All-cause 28-day mortality was 23% in the intervention arm and 29% in standard care (p = 0.04).",
                    "Length of stay averaged 6.2 days across participating centers.",
                ),
            ),
            Triple(
                "Serum lactate clearance predicted early ICU discharge in septic shock.",
                "Serum lactate clearance predicted early ICU discharge",
                listOf(
                    "Patients achieving at least 20% lactate clearance within 6 hours had higher odds of early ICU discharge.",
                    "Baseline procalcitonin values did not differ significantly between survivors and non-survivors.",
                ),
            ),
        )
        val (ctx, claim, ev) = pairs[index % pairs.size]
        return PromptAndSchemaSot.assembleStage2Prompt(template, ctx, claim, ev, wordCap)
    }

    fun b5PromptSample(index: Int, template: String): String =
        if (index % 2 == 0) {
            PromptAndSchemaSot.assembleB5Prompt(
                template = template,
                sectionA = "methods",
                valueA = "48",
                unitA = "patients",
                windowA = "We enrolled 48 adult patients in the primary intervention cohort.",
                sectionB = "results",
                valueB = "46",
                unitB = "patients",
                windowB = "In the primary intervention cohort, 46 patients completed the trial without attrition noted.",
            )
        } else {
            PromptAndSchemaSot.assembleB5Prompt(
                template = template,
                sectionA = "methods",
                valueA = "48",
                unitA = "patients",
                windowA = "We enrolled 48 adult patients at baseline screening.",
                sectionB = "results",
                valueB = "12",
                unitB = "patients",
                windowB = "In the severe hepatic impairment subgroup, 12 patients experienced grade 2 fatigue.",
            )
        }

    fun o2PromptSample(index: Int, template: String): String =
        PromptAndSchemaSot.assembleO2Prompt(
            template = template,
            claimText = "Mean hemoglobin A1c decreased by 1.2% in the high-dose group.",
            headerText = "Group | N | HbA1c change",
            rowText = if (index % 2 == 0) "High-dose | 64 | -1.2%" else "Control | 62 | -0.3%",
        )

    /**
     * 10 clean table cases (>= 3 two-row headers), 6 tilted capture-gate cases, and 4 short-table cases
     * matching `07` §1.4 S-A4 counts.
     */
    fun o2TestCases(): List<O2TestPhotoCase> {
        val cases = ArrayList<O2TestPhotoCase>(20)
        for (i in 0 until 10) {
            val twoRow = i < 4
            val h1 = if (twoRow) listOf("Baseline", "Followup") else listOf("Arm", "N", "Delta")
            val h2 = if (twoRow) listOf("Group", "Count", "Outcome") else emptyList()
            val row = if (twoRow) listOf("DrugA", "${40 + i}", "-${10 + i}%") else listOf("Active", "${50 + i}", "${12 + i}%")
            val expected = if (twoRow) {
                "Baseline \u00B7 Group: DrugA; Baseline \u00B7 Count: ${40 + i}; Followup \u00B7 Outcome: -${10 + i}%"
            } else {
                "Arm: Active; N: ${50 + i}; Delta: ${12 + i}%"
            }
            cases.add(
                O2TestPhotoCase(
                    id = "o2-table-$i",
                    category = O2PhotoCategory.CLEAN_TABLE,
                    hasTwoRowHeader = twoRow,
                    headerRow1 = h1,
                    headerRow2 = h2,
                    dataRows = listOf(row),
                    targetRowIndex = if (twoRow) 2 else 1,
                    expectedEvidenceString = expected,
                ),
            )
        }
        for (i in 0 until 6) {
            cases.add(
                O2TestPhotoCase(
                    id = "o2-gate-tilt-$i",
                    category = O2PhotoCategory.CAPTURE_GATE_TILTED,
                    hasTwoRowHeader = false,
                    headerRow1 = listOf("Arm", "N", "Delta"),
                    headerRow2 = emptyList(),
                    dataRows = listOf(listOf("Placebo", "${30 + i}", "5%")),
                    targetRowIndex = 1,
                    expectedEvidenceString = "",
                    simulatedTiltAnglesDeg = listOf(0.5, 6.2, 1.0, 8.4, 0.8),
                ),
            )
        }
        for (i in 0 until 4) {
            cases.add(
                O2TestPhotoCase(
                    id = "o2-short-table-$i",
                    category = O2PhotoCategory.SHORT_TABLE,
                    hasTwoRowHeader = false,
                    headerRow1 = listOf("Arm", "N", "Delta"),
                    headerRow2 = emptyList(),
                    dataRows = listOf(listOf("Cohort", "${20 + i}", "18%")),
                    targetRowIndex = 1,
                    expectedEvidenceString = "Arm: Cohort; N: ${20 + i}; Delta: 18%",
                    simulatedTiltAnglesDeg = listOf(4.0, 11.0, 5.0),
                ),
            )
        }
        return cases
    }

    fun ftsSeedsAndQueries(): Pair<List<FtsEvidenceSeed>, List<FtsQueryCase>> {
        val terms = listOf(
            "apolipoprotein", "bradycardia", "cardioprotective", "dexamethasone", "endothelial",
            "fibromyalgia", "glomerular", "hemodynamic", "immunoglobulin", "jejunostomy",
            "ketogenesis", "lymphadenopathy", "mitochondrial", "nephropathy", "osteopenia",
            "procalcitonin", "quinolone", "reticulocyte", "sarcopenia", "thrombocytopenia",
        )
        val seeds = terms.mapIndexed { idx, kw ->
            FtsEvidenceSeed(
                chunkId = "chunk-$idx",
                refId = "doi:10.5555/toulmin-sample-$idx",
                section = if (idx % 2 == 0) "results" else "abstract",
                text = "Clinical evaluation of $kw biomarkers in randomized adult patients cohort $idx.",
            )
        }
        val queries = terms.mapIndexed { idx, kw ->
            FtsQueryCase(query = kw, expectedChunkId = "chunk-$idx")
        }
        return seeds to queries
    }
}
