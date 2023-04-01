const express = require('express')
const router = express.Router()

// 	/api/dashboard/categories

router.use(require('./addcategory'))
router.use(require('./deletecategory'))
router.use(require('./editcategorygroupname'))
router.use(require('./editcategory'))
router.use(require('./changecategorygroup'))
router.use(require('./addsubcategory'))
router.use(require('./deletesubcategory'))

module.exports = router;