package app.toulmin.core

import app.toulmin.core.ConformanceTestHelper.bool
import app.toulmin.core.ConformanceTestHelper.str
import app.toulmin.core.ConformanceTestHelper.strOrNull
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

class ConformanceClaimHashTest {
    private fun isLowerHex64(s: String): Boolean {
        if (s.length != 64) return false
        for (i in 0 until 64) {
            val cu = s[i].code
            if (cu !in 48..57 && cu !in 97..102) return false
        }
        return true
    }

    @TestFactory
    fun `conformance l0 claimhash json (AC-L0-21)`(): List<DynamicTest> {
        val cases = ConformanceTestHelper.loadGoldenArray("claimhash.json")
        return cases.map { el ->
            val tc = el.jsonObject
            val id = tc.str("id")
            DynamicTest.dynamicTest(id) {
                val opts = tc.strOrNull("lang")?.let { ClaimNormOptions(lang = it) }
                val a = tc.str("a")
                val b = tc.str("b")
                val normA = normalizedClaim(a, opts)
                val normB = normalizedClaim(b, opts)
                val hashA = normalizedClaimHash(a, opts)
                val hashB = normalizedClaimHash(b, opts)

                assertEquals(tc.str("expectedA"), normA, "[$id] normA")
                assertEquals(tc.str("expectedB"), normB, "[$id] normB")
                assertTrue(isLowerHex64(hashA), "[$id] hashA format")
                assertTrue(isLowerHex64(hashB), "[$id] hashB format")
                assertEquals(tc.bool("expectedEqual"), hashA == hashB, "[$id] expectedEqual")
            }
        }
    }

    @Test
    fun `formatCanonicalDecimal matches ECMAScript Number-to-String across boundary values`() {
        assertEquals("0", formatCanonicalDecimal(0.0))
        assertEquals("0", formatCanonicalDecimal(-0.0))
        assertEquals("5", formatCanonicalDecimal(5.0))
        assertEquals("0.5", formatCanonicalDecimal(0.5))
        assertEquals("2.5", formatCanonicalDecimal(2.50))
        assertEquals("0.001", formatCanonicalDecimal(1e-3))
        assertEquals("0.0001", formatCanonicalDecimal(1e-4))
        assertEquals("0.000001", formatCanonicalDecimal(1e-6))
        assertEquals("1e-7", formatCanonicalDecimal(1e-7))
        assertEquals("-1.5e-7", formatCanonicalDecimal(-1.5e-7))
        assertEquals("10000000", formatCanonicalDecimal(1e7))
        assertEquals("100000000000000000000", formatCanonicalDecimal(1e20))
        assertEquals("1e+21", formatCanonicalDecimal(1e21))
        assertEquals("1.2345678901234567", formatCanonicalDecimal(1.2345678901234567))

        // ECMAScript Number::toString scientific & subnormal tie-even boundary values
        assertEquals("6.022e+21", formatCanonicalDecimal(6.022e21))
        assertEquals("6.626e+21", formatCanonicalDecimal(6.626e21))
        assertEquals("1.23e+22", formatCanonicalDecimal(1.23e22))
        assertEquals("5e+22", formatCanonicalDecimal(5e22))
        assertEquals("7e+22", formatCanonicalDecimal(7e22))
        assertEquals("1e+23", formatCanonicalDecimal(1e23))
        assertEquals("2e+23", formatCanonicalDecimal(2e23))
        assertEquals("5e-324", formatCanonicalDecimal(Double.fromBits(1L)))
        assertEquals("5e-323", formatCanonicalDecimal(Double.fromBits(10L)))
        assertEquals("1.7976931348623157e+308", formatCanonicalDecimal(Double.MAX_VALUE))

        assertEquals(
            "fa129347ea8ad3a9507afe4759f636e15b87d9fcdddaa5d38fc2a7e740171a14",
            normalizedClaimHash("1e23 mg"),
        )
        assertEquals(
            "590afc28baf8bf1e6355f5c353982584f20b25edcd6b5c2d2f00dbdfb4eeeccc",
            normalizedClaimHash("1.23e22 mg"),
        )
    }
}
