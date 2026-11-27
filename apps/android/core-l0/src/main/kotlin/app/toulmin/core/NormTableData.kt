package app.toulmin.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal class NormTable(
    val latinCompose: Map<String, String>,
    val map: Map<String, String>,
    val lowerOverrides: Map<String, String>,
    val latinFold: Map<String, String>,
    val compatFold: Map<String, String>,
    val confusables: Map<String, String>,
    val symbolPuaTable: Map<String, String>,
)

internal class Unicode151Table(
    val bmpCategories: ByteArray,
    val bmpSimpleLower: IntArray,
    val suppCatStarts: IntArray,
    val suppCatEnds: IntArray,
    val suppCatCodes: ByteArray,
    val suppLowerSrc: IntArray,
    val suppLowerDst: IntArray,
)

internal object NormTableData {
    private const val BMP_SIZE = 0x10000

    val normTable: NormTable
    val stage2MapByCp: Map<Int, String>
    val lowerOverridesByCp: Map<Int, String>
    val maxLatinComposeSeqUnits: Int
    val unicodeBytes: ByteArray
    val unicodeTable: Unicode151Table

    // Exact sorted disjoint ranges from packages/core-l0/src/unicode_15_1.generated.ts (02 §2.2.2)
    val joinerRangeStarts: IntArray = intArrayOf(
        0x0590, 0x061D, 0x0750, 0x0870, 0x0B80, 0x203C, 0x2049, 0x20E3, 0x2122, 0x2139,
        0x2194, 0x21A9, 0x231A, 0x2328, 0x2388, 0x23CF, 0x23E9, 0x23F8, 0x24C2, 0x25AA,
        0x25B6, 0x25C0, 0x25FB, 0x2600, 0x2607, 0x2614, 0x2690, 0x2708, 0x2714, 0x2716,
        0x271D, 0x2721, 0x2728, 0x2733, 0x2744, 0x2747, 0x274C, 0x274E, 0x2753, 0x2757,
        0x2763, 0x2795, 0x27A1, 0x27B0, 0x27BF, 0x2934, 0x2B05, 0x2B1B, 0x2B50, 0x2B55,
        0x3030, 0x303D, 0x3297, 0x3299, 0xA8E0, 0xFB1D, 0xFE0F, 0xFE70, 0x10E60, 0x10EC0,
        0x111E0, 0x11B00, 0x11FC0, 0x1EE00, 0x1F000, 0x1F10D, 0x1F12F, 0x1F16C, 0x1F17E, 0x1F18E,
        0x1F191, 0x1F1AD, 0x1F201, 0x1F21A, 0x1F22F, 0x1F232, 0x1F23C, 0x1F249, 0x1F546, 0x1F680,
        0x1F774, 0x1F7D5, 0x1F80C, 0x1F848, 0x1F85A, 0x1F888, 0x1F8AE, 0x1F90C, 0x1F93C, 0x1F947,
        0x1FC00,
    )

    val joinerRangeEnds: IntArray = intArrayOf(
        0x061B, 0x06FF, 0x077F, 0x0AFF, 0x0DFF, 0x203C, 0x2049, 0x20E3, 0x2122, 0x2139,
        0x2199, 0x21AA, 0x231B, 0x2328, 0x2388, 0x23CF, 0x23F3, 0x23FA, 0x24C2, 0x25AB,
        0x25B6, 0x25C0, 0x25FE, 0x2605, 0x2612, 0x2685, 0x2705, 0x2712, 0x2714, 0x2716,
        0x271D, 0x2721, 0x2728, 0x2734, 0x2744, 0x2747, 0x274C, 0x274E, 0x2755, 0x2757,
        0x2767, 0x2797, 0x27A1, 0x27B0, 0x27BF, 0x2935, 0x2B07, 0x2B1C, 0x2B50, 0x2B55,
        0x3030, 0x303D, 0x3297, 0x3299, 0xA8FF, 0xFDFF, 0xFE0F, 0xFEFE, 0x10E7E, 0x10EFF,
        0x111FF, 0x11B5F, 0x11FFF, 0x1EEFF, 0x1F0FF, 0x1F10F, 0x1F12F, 0x1F171, 0x1F17F, 0x1F18E,
        0x1F19A, 0x1F1FF, 0x1F20F, 0x1F21A, 0x1F22F, 0x1F23A, 0x1F23F, 0x1F53D, 0x1F64F, 0x1F6FF,
        0x1F77F, 0x1F7FF, 0x1F80F, 0x1F84F, 0x1F85F, 0x1F88F, 0x1F8FF, 0x1F93A, 0x1F945, 0x1FAFF,
        0x1FFFD,
    )

    init {
        val normJsonText = loadResourceBytes("norm_table.json").decodeToString()
        val root = Json.parseToJsonElement(normJsonText).jsonObject

        fun readStringMap(key: String): Map<String, String> {
            val obj = root[key]?.jsonObject ?: error("Missing '$key' in norm_table.json")
            val out = LinkedHashMap<String, String>(obj.size * 2)
            for ((k, v) in obj) {
                out[k] = v.jsonPrimitive.content
            }
            return out
        }

        normTable = NormTable(
            latinCompose = readStringMap("latin_compose"),
            map = readStringMap("map"),
            lowerOverrides = readStringMap("lower_overrides"),
            latinFold = readStringMap("latin_fold"),
            compatFold = readStringMap("compat_fold"),
            confusables = readStringMap("confusables"),
            symbolPuaTable = readStringMap("SYMBOL_PUA_TABLE"),
        )

        val stage2Map = HashMap<Int, String>(normTable.map.size * 2)
        for ((k, v) in normTable.map) {
            if (k.isNotEmpty()) {
                stage2Map[codePointAtSafe(k, 0).cp] = v
            }
        }
        stage2MapByCp = stage2Map

        val lowerMap = HashMap<Int, String>(normTable.lowerOverrides.size * 2)
        for ((k, v) in normTable.lowerOverrides) {
            if (k.isNotEmpty()) {
                lowerMap[codePointAtSafe(k, 0).cp] = v
            }
        }
        lowerOverridesByCp = lowerMap

        var maxLen = 0
        for (k in normTable.latinCompose.keys) {
            if (k.length > maxLen) {
                maxLen = k.length
            }
        }
        maxLatinComposeSeqUnits = maxLen

        unicodeBytes = loadResourceBytes("unicode_15_1.bin")
        unicodeTable = parseUnicode151Bin(unicodeBytes)
    }

    private fun loadResourceBytes(name: String): ByteArray {
        val stream = NormTableData::class.java.classLoader?.getResourceAsStream(name)
            ?: error("Missing bundled Tier A resource: $name")
        return stream.use { it.readBytes() }
    }

    private fun readU16LE(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or ((bytes[offset + 1].toInt() and 0xFF) shl 8)

    private fun readU32LE(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xFF) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 3].toInt() and 0xFF) shl 24)

    fun parseUnicode151Bin(bytes: ByteArray): Unicode151Table {
        if (bytes.size < 16) {
            error("unicode_15_1.bin too short")
        }
        if (bytes[0] != 0x55.toByte() ||
            bytes[1] != 0x31.toByte() ||
            bytes[2] != 0x35.toByte() ||
            bytes[3] != 0x31.toByte()
        ) {
            error("Invalid unicode_15_1.bin magic header")
        }
        val version = readU16LE(bytes, 4)
        if (version != 1) {
            error("Unsupported unicode_15_1.bin version: $version")
        }
        val catRunCount = readU32LE(bytes, 8)
        val lowerCount = readU32LE(bytes, 12)
        val expectedLength = 16 + (catRunCount + lowerCount) * 8
        if (bytes.size != expectedLength) {
            error("Corrupt unicode_15_1.bin length: expected $expectedLength, got ${bytes.size}")
        }

        val bmpCategories = ByteArray(BMP_SIZE)
        val bmpSimpleLower = IntArray(BMP_SIZE)

        val suppCatStartsList = IntBuf(64)
        val suppCatEndsList = IntBuf(64)
        val suppCatCodesList = ByteBuf(64)

        var offset = 16
        for (i in 0 until catRunCount) {
            val word0 = readU32LE(bytes, offset)
            val end = readU32LE(bytes, offset + 4)
            offset += 8

            val start = word0 and 0x1fffff
            val catCode = (word0 ushr 24) and 0xff
            if (catCode >= GENERAL_CATEGORIES.size) {
                error("Invalid category code $catCode in unicode_15_1.bin")
            }

            if (start < BMP_SIZE) {
                val bmpEnd = if (end < BMP_SIZE) end else BMP_SIZE - 1
                val bCode = catCode.toByte()
                for (cp in start..bmpEnd) {
                    bmpCategories[cp] = bCode
                }
            }
            if (end >= BMP_SIZE) {
                val suppStart = if (start >= BMP_SIZE) start else BMP_SIZE
                suppCatStartsList.add(suppStart)
                suppCatEndsList.add(end)
                suppCatCodesList.add(catCode.toByte())
            }
        }

        val suppLowerSrcList = IntBuf(128)
        val suppLowerDstList = IntBuf(128)

        for (i in 0 until lowerCount) {
            val src = readU32LE(bytes, offset)
            val dst = readU32LE(bytes, offset + 4)
            offset += 8

            if (src < BMP_SIZE) {
                bmpSimpleLower[src] = dst
            } else {
                suppLowerSrcList.add(src)
                suppLowerDstList.add(dst)
            }
        }

        return Unicode151Table(
            bmpCategories = bmpCategories,
            bmpSimpleLower = bmpSimpleLower,
            suppCatStarts = suppCatStartsList.toArray(),
            suppCatEnds = suppCatEndsList.toArray(),
            suppCatCodes = suppCatCodesList.toArray(),
            suppLowerSrc = suppLowerSrcList.toArray(),
            suppLowerDst = suppLowerDstList.toArray(),
        )
    }
}

internal class IntBuf(initialCapacity: Int = 16) {
    private var data = IntArray(initialCapacity.coerceAtLeast(4))
    var size: Int = 0
        private set

    fun add(value: Int) {
        if (size == data.size) {
            data = data.copyOf(data.size * 2)
        }
        data[size++] = value
    }

    operator fun get(index: Int): Int = data[index]

    operator fun set(index: Int, value: Int) {
        data[index] = value
    }

    fun popLast(): Int {
        size--
        return data[size]
    }

    fun toArray(): IntArray = data.copyOf(size)
}

internal class CharBuf(initialCapacity: Int = 32) {
    private var data = CharArray(initialCapacity.coerceAtLeast(8))
    var size: Int = 0
        private set

    fun add(ch: Char) {
        if (size == data.size) {
            data = data.copyOf(data.size * 2)
        }
        data[size++] = ch
    }

    fun addCodeUnit(cu: Int) {
        add(cu.toChar())
    }

    operator fun get(index: Int): Char = data[index]

    fun buildString(): String = String(data, 0, size)
}

internal class ByteBuf(initialCapacity: Int = 16) {
    private var data = ByteArray(initialCapacity.coerceAtLeast(4))
    var size: Int = 0
        private set

    fun add(value: Byte) {
        if (size == data.size) {
            data = data.copyOf(data.size * 2)
        }
        data[size++] = value
    }

    fun toArray(): ByteArray = data.copyOf(size)
}
