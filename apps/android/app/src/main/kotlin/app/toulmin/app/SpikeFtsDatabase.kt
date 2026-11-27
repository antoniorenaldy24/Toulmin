package app.toulmin.app

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Fts4
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "evidence")
data class SpikeEvidenceEntity(
    @PrimaryKey(autoGenerate = true) val rowid: Int = 0,
    val chunkId: String,
    val refId: String,
    val section: String,
    val text: String,
)

@Fts4(contentEntity = SpikeEvidenceEntity::class)
@Entity(tableName = "evidence_fts")
data class SpikeEvidenceFts(
    val chunkId: String,
    val refId: String,
    val section: String,
    val text: String,
)

@Dao
interface SpikeEvidenceDao {
    @Insert
    suspend fun insertAll(items: List<SpikeEvidenceEntity>)

    @Query(
        "SELECT e.* FROM evidence e " +
            "JOIN evidence_fts fts ON e.rowid = fts.rowid " +
            "WHERE evidence_fts MATCH :query",
    )
    suspend fun search(query: String): List<SpikeEvidenceEntity>
}

@Database(
    entities = [SpikeEvidenceEntity::class, SpikeEvidenceFts::class],
    version = 1,
    exportSchema = false,
)
abstract class SpikeFtsDatabase : RoomDatabase() {
    abstract fun evidenceDao(): SpikeEvidenceDao
}
