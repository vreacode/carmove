import unittest

import numpy as np

from frontier_explorer import frontier_clusters, frontier_mask


class FrontierDetectionTests(unittest.TestCase):
    def test_detects_free_cells_adjacent_to_unknown(self):
        grid = np.array(
            [
                [-1, -1, -1, -1, -1],
                [-1, 0, 0, 0, -1],
                [-1, 0, 100, 0, -1],
                [-1, 0, 0, 0, -1],
                [-1, -1, -1, -1, -1],
            ],
            dtype=np.int16,
        )
        mask = frontier_mask(grid)
        self.assertFalse(mask[2, 2])
        self.assertTrue(mask[1, 1])
        self.assertEqual(int(mask.sum()), 8)

    def test_groups_connected_frontier_cells(self):
        mask = np.zeros((6, 8), dtype=bool)
        mask[1, 1:4] = True
        mask[4, 5:7] = True
        clusters = frontier_clusters(mask, minimum_cells=2)
        self.assertEqual(sorted(len(cluster) for cluster in clusters), [2, 3])


if __name__ == "__main__":
    unittest.main()
