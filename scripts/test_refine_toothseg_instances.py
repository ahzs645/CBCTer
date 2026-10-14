"""Synthetic regression for tooth splits, retained unknowns and physical geometry."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
import SimpleITK as sitk

from refine_toothseg_instances import refine


class RefinementTest(unittest.TestCase):
    def test_split_preserves_voxels_geometry_and_unnumbered_region(self):
        raw = np.zeros((20, 20, 40), np.uint16)
        raw[2:12, 2:12, 2:22] = 1
        raw[2:12, 2:12, 24:34] = 2
        semantic = np.zeros_like(raw)
        semantic[2:12, 2:12, 2:12] = 1
        semantic[2:12, 2:12, 12:22] = 2
        # Unclassified voxels inside the merged mask must be allocated, not lost.
        semantic[2, 2:12, 2:22] = 0
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, array in [('instances', raw), ('semantic', semantic)]:
                image = sitk.GetImageFromArray(array)
                image.SetSpacing([.5, .5, .5])
                image.SetOrigin([-12, 3, 8])
                image.SetDirection([0, -1, 0, 1, 0, 0, 0, 0, 1])
                sitk.WriteImage(image, str(root/(name+'.nii.gz')))
            output = root/'review.nii.gz'
            summary = refine(root/'instances.nii.gz', root/'semantic.nii.gz', output)
            image = sitk.ReadImage(str(output))
            result = sitk.GetArrayFromImage(image)
            np.testing.assert_array_equal(result != 0, raw != 0)
            np.testing.assert_array_equal(result[raw == 2], np.full(int((raw == 2).sum()), 2))
            self.assertEqual(json.loads(Path(str(output)+'.fdi.json').read_text()), {'1': 11, '3': 12, '2': None})
            self.assertEqual(sum(d['split'] for d in summary['instances']), 2)
            self.assertEqual(image.GetOrigin(), (-12, 3, 8))
            self.assertEqual(image.GetSpacing(), (.5, .5, .5))
            self.assertEqual(image.GetDirection(), (0, -1, 0, 1, 0, 0, 0, 0, 1))


if __name__ == '__main__':
    unittest.main()
