package app.toulmin.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

internal object ConformanceTestHelper {
    val repoRoot: Path by lazy {
        val prop = System.getProperty("toulmin.repoRoot")
        if (!prop.isNullOrBlank()) {
            Paths.get(prop).toAbsolutePath().normalize()
        } else {
            Paths.get("").toAbsolutePath().resolve("../..").normalize()
        }
    }

    fun loadGoldenArray(fileName: String): JsonArray {
        val path = repoRoot.resolve("conformance").resolve("l0").resolve(fileName)
        val raw = Files.readString(path, Charsets.UTF_8)
        return Json.parseToJsonElement(raw).jsonArray
    }

    fun JsonObject.strOrNull(key: String): String? {
        val el = this[key] ?: return null
        if (el is JsonNull) return null
        return el.jsonPrimitive.content
    }

    fun JsonObject.str(key: String): String =
        this[key]?.jsonPrimitive?.content ?: error("Missing string field '$key'")

    fun JsonObject.bool(key: String): Boolean =
        this[key]?.jsonPrimitive?.boolean ?: error("Missing boolean field '$key'")

    fun JsonObject.boolOrNull(key: String): Boolean? {
        val el = this[key] ?: return null
        if (el is JsonNull) return null
        return el.jsonPrimitive.boolean
    }

    fun JsonObject.intVal(key: String): Int =
        this[key]?.jsonPrimitive?.int ?: error("Missing int field '$key'")

    fun JsonObject.intOrNull(key: String): Int? {
        val el = this[key] ?: return null
        if (el is JsonNull) return null
        return el.jsonPrimitive.int
    }

    fun JsonObject.longVal(key: String): Long =
        this[key]?.jsonPrimitive?.long ?: error("Missing long field '$key'")

    fun JsonObject.longOrNull(key: String): Long? {
        val el = this[key] ?: return null
        if (el is JsonNull) return null
        return el.jsonPrimitive.long
    }

    fun JsonObject.doubleVal(key: String): Double =
        this[key]?.jsonPrimitive?.double ?: error("Missing double field '$key'")

    fun JsonObject.doubleOrNull(key: String): Double? {
        val el = this[key] ?: return null
        if (el is JsonNull) return null
        return el.jsonPrimitive.double
    }

    fun JsonElement.asIntList(): List<Int> = jsonArray.map { it.jsonPrimitive.int }

    fun JsonElement.asStringList(): List<String> = jsonArray.map { it.jsonPrimitive.content }

    fun JsonElement.asBoolList(): List<Boolean> = jsonArray.map { it.jsonPrimitive.boolean }
}
