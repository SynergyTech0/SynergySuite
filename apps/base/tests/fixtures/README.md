# Access test files

`shop.accdb` (Access 2010 format) and `shop.mdb` (Access 2000 format) hold the same small shop,
made for these tests with [Jackcess](https://jackcess.sourceforge.io/) (Apache-2.0):

- **Customers**: CustomerID (AutoNumber, primary key; numbers 1, 2, 3 and 10), Name, City,
  Code (text with leading zeros), Joined (dates), VIP (Yes/No), Notes (Long Text), Referred By
  (Number, related to Customers.CustomerID with "cascade null on delete").
- **Products**: SKU (text primary key), Title, Price (Currency).
- **Orders**: OrderID (AutoNumber), Customer (related to Customers.CustomerID, cascade delete),
  SKU (related to Products.SKU), Amount (Currency), Qty (Integer), Weight (Double), Ordered
  (date and time), Ref (Replication ID), Photo (OLE object, one row filled).

`attachments.accdb` comes from mdb-reader's own tests (MIT,
https://github.com/andipaetzold/mdb-reader/tree/main/test/data): a table with an AutoNumber, a
text field and an Attachments field.
